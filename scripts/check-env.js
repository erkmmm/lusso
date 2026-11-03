// Runs first in every build — refuses to build a bundle that cannot talk to
// its backend.
//
// Vite inlines import.meta.env at build time, so a missing VITE_* var is not
// an error: it folds to undefined, the dead branch is tree-shaken, and the
// build succeeds. On 2026-11-03 that shipped a production bundle with no
// Supabase client at all (built in a scratch worktree, which has no
// .env.local). The app loaded, the login form rendered, and signIn threw on a
// null client — so the button span forever and nothing explained why.
//
// A build missing these is never the build anyone wanted. Fail loudly here,
// where the message can say which file to look in, rather than silently in a
// browser three steps later.
import { loadEnv } from 'vite';

// Same resolution order Vite itself uses for `vite build` (.env, .env.local,
// .env.production, .env.production.local, plus matching process.env entries),
// so this check sees exactly what the bundle will.
const env = loadEnv(process.env.MODE || 'production', process.cwd(), 'VITE_');

const missing = [];

if (!env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL');
// supabase.js accepts either key name, so only the pair being empty is fatal.
if (!env.VITE_SUPABASE_PUBLISHABLE_KEY && !env.VITE_SUPABASE_ANON_KEY) {
  missing.push('VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY)');
}
// Supabase Auth has CAPTCHA protection switched on, so a bundle without the
// site key sends no token and every sign-in is rejected with captcha_failed.
if (!env.VITE_TURNSTILE_SITE_KEY) missing.push('VITE_TURNSTILE_SITE_KEY');

if (missing.length) {
  console.error(`
[check-env] Refusing to build — missing: ${missing.join(', ')}

  Building in ${process.cwd()}

  Local builds read .env.local, which is gitignored and so does NOT exist in a
  fresh clone or a scratch worktree. Build from /Users/jett/lusso, or copy
  .env.local across first.

  Cloudflare's own builds (triggered by a push to main) read the Pages project
  environment variables instead — add it there as well if this is a new var:
  Workers & Pages → lusso → Settings → Variables.

  Deliberately building without them: LUSSO_ALLOW_INCOMPLETE_BUILD=1 npm run build
`);
  if (process.env.LUSSO_ALLOW_INCOMPLETE_BUILD !== '1') process.exit(1);
  console.error('[check-env] LUSSO_ALLOW_INCOMPLETE_BUILD=1 set — continuing anyway.\n');
}
