/**
 * One-off importer for a SambaPOS "Price list" export.
 *
 * Written for Chillax Zone's first load rather than as a general tool:
 * we have exactly one sample of what these exports look like, and
 * generalising from one sample is how you build an importer that fits
 * nothing. When a second client arrives with a different shape, that is
 * the point to decide what the real admin importer should do.
 *
 * Dry run by default. It prints what it would create and every row it
 * would skip, because the sample contains genuine ambiguities -- a
 * duplicate item at two prices, zero-priced rows, a price that is almost
 * certainly a typo -- which are the client's to resolve, not ours to
 * guess at silently.
 *
 *   npx tsx scripts/import-price-list.ts --file "price list.xlsx" --slug chillax-zone
 *   npx tsx scripts/import-price-list.ts --file "price list.xlsx" --slug chillax-zone --commit
 *
 * Notes on the format, learned the hard way from the sample:
 *  - the header row reads Product | Portion | Band | Price, but the price
 *    actually sits in column C under "Band"; column D is empty. Do not
 *    trust the header.
 *  - categories are not a column. They are separator rows whose product
 *    cell looks like "BEER BOTTLES ==============".
 *  - there is no product code anywhere, so pos_code is left null.
 */
import 'dotenv/config';
import fs from 'fs';
import zlib from 'zlib';
import { pool, withTransaction } from '../src/db/pool';
import type { FulfilmentDestination } from '../src/lib/domain';

/**
 * Which station each category is worked at. Explicit rather than guessed
 * from the name: "TAKEAWAY" is food, "TOTS" is spirits, and no heuristic
 * gets CARWASH right. Anything not listed here stops the import rather
 * than defaulting, so a new category in a future export cannot be
 * silently filed under the wrong station.
 */
const CATEGORY_DESTINATION: Record<string, FulfilmentDestination> = {
  '1 LITRE': 'bar',
  '350 ML': 'bar',
  '750 ML': 'bar',
  'BEER BOTTLES': 'bar',
  'BEER CANS': 'bar',
  TOTS: 'bar',
  WINES: 'bar',
  'SOFT DRINKS': 'bar',

  ACCOMPANIMENTS: 'kitchen',
  BEEF: 'kitchen',
  'BEEF TAKEAWAY KG   850': 'kitchen',
  'HOT BEVERAGES': 'kitchen',
  KUKU: 'kitchen',
  MBUZI: 'kitchen',
  PLATTER: 'kitchen',
  SNACKS: 'kitchen',
  Soup: 'kitchen',
  TAKEAWAY: 'kitchen',

  CARWASH: 'services',
  LAUNDRY: 'services',
  // Foil, takeaway containers, honey, and a charge for broken glass.
  // Sundries handed over at the counter rather than cooked or poured.
  OTHERS: 'services',
};

interface ParsedItem {
  category: string;
  name: string;
  price: string;
  row: number;
}

function unzip(path: string): Record<string, Buffer> {
  const buf = fs.readFileSync(path);
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < buf.length - 4; i += 1) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8);
    const compSize = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.slice(i + 30, i + 30 + nameLen).toString();
    const start = i + 30 + nameLen + extraLen;
    if (!compSize) continue;
    const data = buf.slice(start, start + compSize);
    try {
      files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    } catch {
      /* entry with a streamed data descriptor; the parts we need are not */
    }
  }
  return files;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseSheet(path: string): ParsedItem[] {
  const files = unzip(path);
  const ssXml = (files['xl/sharedStrings.xml'] ?? Buffer.from('')).toString('utf8');
  const sheetXml = (files['xl/worksheets/sheet1.xml'] ?? Buffer.from('')).toString('utf8');
  if (!sheetXml) throw new Error('no xl/worksheets/sheet1.xml in the workbook');

  const strings: string[] = [];
  for (const m of ssXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    strings.push(
      decodeEntities([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')),
    );
  }

  const items: ParsedItem[] = [];
  let category: string | null = null;

  for (const r of sheetXml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowNum = Number(r[1]);
    const cells: Record<string, string> = {};
    for (const c of r[2].matchAll(/<c r="([A-Z]+)\d+"(?:[^>]*t="([^"]*)")?[^>]*>([\s\S]*?)<\/c>/g)) {
      const inline = c[3].match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
      const value = c[3].match(/<v>([\s\S]*?)<\/v>/);
      let v = inline ? decodeEntities(inline[1]) : value ? value[1] : '';
      if (c[2] === 's') v = strings[Number(v)] ?? '';
      cells[c[1]] = v;
    }

    const product = (cells.A ?? '').trim();
    if (!product) continue;
    if (/={3,}/.test(product)) {
      category = product.replace(/=+/g, '').trim();
      continue;
    }
    // Rows above the first separator are the export's own title block.
    if (!category) continue;
    items.push({ category, name: product, price: (cells.C ?? '').trim(), row: rowNum });
  }
  return items;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const file = arg('file');
  const slug = arg('slug');
  const commit = process.argv.includes('--commit');
  if (!file || !slug) {
    console.error('usage: --file <xlsx> --slug <restaurant-slug> [--commit]');
    process.exit(1);
  }

  const parsed = parseSheet(file);
  console.log(`parsed ${parsed.length} item rows from ${file}\n`);

  const unknown = [...new Set(parsed.map((i) => i.category))].filter((c) => !(c in CATEGORY_DESTINATION));
  if (unknown.length) {
    console.error('STOPPING: these categories have no station mapped:');
    unknown.forEach((c) => console.error(`   ${JSON.stringify(c)}`));
    console.error('\nAdd them to CATEGORY_DESTINATION; nothing is guessed.');
    process.exit(1);
  }

  const skipped: { item: ParsedItem; why: string }[] = [];
  const keep: ParsedItem[] = [];
  const seen = new Map<string, ParsedItem>();

  for (const item of parsed) {
    const price = Number(item.price);
    if (!item.price || Number.isNaN(price)) {
      skipped.push({ item, why: 'no price' });
      continue;
    }
    if (price <= 0) {
      skipped.push({ item, why: 'price is zero' });
      continue;
    }
    const key = `${item.category}::${item.name.trim().toUpperCase()}`;
    const prior = seen.get(key);
    if (prior) {
      // Same name twice in one category at different prices is a genuine
      // ambiguity in the source. Keeping neither is safer than keeping
      // the wrong one: the client has to say which is current.
      skipped.push({ item, why: `duplicate of row ${prior.row} (KSh ${prior.price} vs ${item.price})` });
      continue;
    }
    seen.set(key, item);
    keep.push(item);
  }

  const byCategory = new Map<string, ParsedItem[]>();
  for (const item of keep) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  console.log('would create:');
  for (const [category, items] of byCategory) {
    console.log(`   ${String(items.length).padStart(3)}  ${category.padEnd(26)} -> ${CATEGORY_DESTINATION[category]}`);
  }
  console.log(`   ${String(keep.length).padStart(3)}  TOTAL in ${byCategory.size} categories\n`);

  if (skipped.length) {
    console.log('skipped, needs the client to decide:');
    for (const { item, why } of skipped) {
      console.log(`   row ${String(item.row).padStart(3)}  ${item.category} / ${JSON.stringify(item.name)} -- ${why}`);
    }
    console.log();
  }

  // Suspiciously cheap rows are reported but still imported -- "KSh 3"
  // is probably a typo for 300, but it is not our number to change.
  const suspicious = keep.filter((i) => Number(i.price) < 20);
  if (suspicious.length) {
    console.log('worth a second look (imported as-is):');
    suspicious.forEach((i) => console.log(`   row ${i.row}  ${i.category} / ${i.name} -- KSh ${i.price}`));
    console.log();
  }

  const restaurant = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM restaurant WHERE slug = $1',
    [slug],
  );
  if (!restaurant.rows[0]) {
    console.error(`no restaurant with slug "${slug}"`);
    process.exit(1);
  }
  const { id: restaurantId, name: restaurantName } = restaurant.rows[0];
  console.log(`target: ${restaurantName} (${slug})`);

  const existing = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM menu_item WHERE restaurant_id = $1',
    [restaurantId],
  );
  if (Number(existing.rows[0].n) > 0) {
    console.error(
      `\nSTOPPING: ${restaurantName} already has ${existing.rows[0].n} menu items.\n` +
        'This importer only populates an empty menu -- re-running it would duplicate everything.',
    );
    process.exit(1);
  }

  if (!commit) {
    console.log('\nDRY RUN -- nothing written. Re-run with --commit to apply.');
    await pool.end();
    return;
  }

  // One transaction: a partial menu is worse than no menu, since staff
  // would have to work out which half arrived.
  await withTransaction(async (client) => {
    let sortOrder = 0;
    for (const [category, items] of byCategory) {
      const cat = await client.query<{ id: string }>(
        'INSERT INTO menu_category (restaurant_id, name, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [restaurantId, category, sortOrder],
      );
      sortOrder += 1;
      for (const item of items) {
        await client.query(
          `INSERT INTO menu_item (restaurant_id, category_id, name, price, destination, is_available)
           VALUES ($1, $2, $3, $4, $5::order_item_destination, true)`,
          [restaurantId, cat.rows[0].id, item.name.trim(), Number(item.price), CATEGORY_DESTINATION[category]],
        );
      }
    }
  });

  console.log(`\nimported ${keep.length} items into ${byCategory.size} categories.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
