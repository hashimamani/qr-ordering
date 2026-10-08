/**
 * Puts an existing flat set of categories under main categories.
 *
 * Chillax Zone's 273 items arrived in 21 top-level categories, which is
 * correct data and an unusable menu. This only moves categories: no item
 * is touched, so prices and the POS mapping cannot drift.
 *
 * Dry run by default, like the importer. Emits a seed-Lambda payload for
 * production, where the database is inside the VPC.
 */
import 'dotenv/config';
import fs from 'fs';
import { pool } from '../src/db/pool';

/** Main category -> the existing categories that belong under it. */
const GROUPS: Record<string, string[]> = {
  Food: [
    'ACCOMPANIMENTS', 'BEEF', 'BEEF TAKEAWAY KG   850', 'HOT BEVERAGES',
    'KUKU', 'MBUZI', 'PLATTER', 'SNACKS', 'Soup', 'TAKEAWAY',
  ],
  Drinks: [
    '1 LITRE', '350 ML', '750 ML', 'BEER BOTTLES', 'BEER CANS',
    'SOFT DRINKS', 'TOTS', 'WINES',
  ],
  Services: ['CARWASH', 'LAUNDRY', 'OTHERS'],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const slug = arg('slug');
  const emit = arg('emit');
  const commit = process.argv.includes('--commit');
  if (!slug) {
    console.error('usage: --slug <restaurant-slug> [--commit | --emit <file>]');
    process.exit(1);
  }

  const payload = { slug, groups: GROUPS };
  if (emit) {
    fs.writeFileSync(emit, JSON.stringify({ regroupCategories: payload }, null, 1));
    console.log(`wrote seed-Lambda payload to ${emit}`);
    await pool.end();
    return;
  }

  const { regroupCategories } = await import('../src/modules/menu/menuImport');
  if (!commit) {
    const plan = Object.entries(GROUPS)
      .map(([main, subs]) => `   ${main}: ${subs.length} sub-categories`)
      .join('\n');
    console.log(`would create ${Object.keys(GROUPS).length} main categories:\n${plan}`);
    console.log('\nDRY RUN -- re-run with --commit (local) or --emit <file> (production).');
    await pool.end();
    return;
  }
  const result = await regroupCategories(slug, GROUPS);
  console.log(`created ${result.created} main categories, re-parented ${result.moved} existing ones.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
