import 'dotenv/config';
import { pool } from '../db/pool';
import { createPlatformAdmin } from '../modules/platformAdmin/platformAdmin.service';

function parseArgs(): { name: string; email: string; password: string } {
  const args = new Map<string, string>();
  for (const raw of process.argv.slice(2)) {
    const match = raw.match(/^--([a-z]+)=(.*)$/);
    if (match) args.set(match[1], match[2]);
  }
  const name = args.get('name');
  const email = args.get('email');
  const password = args.get('password');
  if (!name || !email || !password) {
    console.error('Usage: npm run create-platform-admin -- --name="Jane Doe" --email=jane@example.com --password=...');
    process.exit(1);
  }
  return { name, email, password };
}

async function main() {
  const { name, email, password } = parseArgs();
  const admin = await createPlatformAdmin(name, email, password);
  console.log(`Created platform admin: ${admin.name} <${admin.email}> (${admin.id})`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
