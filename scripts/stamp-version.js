// Runs before every build — writes the current timestamp into public/version.json
// so the PWA version check can detect new deployments.
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ts = Date.now().toString();
writeFileSync(
  join(__dirname, '../public/version.json'),
  JSON.stringify({ v: ts }) + '\n'
);
console.log(`[version] stamped ${ts}`);
