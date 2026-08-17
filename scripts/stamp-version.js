// Runs before every build — writes build identity into public/version.json.
//
//   v       epoch ms. Unchanged: useVersionCheck compares this to detect a new
//           deployment, so it must stay a plain changing value.
//   sha     short git commit the build came from — the unambiguous answer to
//           "is what I'm looking at the thing I just deployed?".
//   builtAt ISO timestamp, rendered in the sidebar as a readable local time.
//
// vite.config.js reads this file at config time and inlines the values, so the
// running bundle reports its OWN build rather than whatever version.json the
// server currently serves. That distinction matters: if the browser is holding
// a stale cached bundle, the marker shows the stale build, which is the truth
// the user needs.
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ts = Date.now().toString();

let sha = 'nogit';
let dirty = false;
try {
  sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  // Uncommitted changes mean the build doesn't match the commit — flag it so a
  // marker reading "abc1234+" is never mistaken for a clean, reproducible build.
  dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
} catch {
  // Not a git checkout (or git unavailable) — the timestamp still identifies it.
}

const payload = {
  v: ts,
  sha: dirty ? `${sha}+` : sha,
  builtAt: new Date().toISOString(),
};

writeFileSync(
  join(__dirname, '../public/version.json'),
  JSON.stringify(payload) + '\n'
);
console.log(`[version] stamped ${payload.sha} at ${payload.builtAt}`);
