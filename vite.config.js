import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'

// Inline the build identity stamped by scripts/stamp-version.js (which runs
// immediately before vite build). Baking it into the bundle — rather than
// fetching version.json at runtime — means the sidebar marker reports the build
// the browser is actually running, so a stale cached bundle is visible instead
// of being masked by a fresh version.json from the server.
function buildInfo() {
  try {
    return JSON.parse(readFileSync(new URL('./public/version.json', import.meta.url), 'utf8'))
  } catch {
    return { v: 'dev', sha: 'dev', builtAt: new Date().toISOString() }
  }
}

const info = buildInfo()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Honour PORT so the dev server can be told which port to take. Vite does not
  // read it on its own — it defaults to 5173 — which means a harness that
  // assigns a free port and passes it through the environment would be ignored,
  // and two dev servers would collide on the same hardcoded port instead.
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  define: {
    __BUILD_SHA__: JSON.stringify(info.sha ?? 'dev'),
    __BUILT_AT__:  JSON.stringify(info.builtAt ?? new Date().toISOString()),
  },
})
