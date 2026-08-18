import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        // Inlined at build time by vite.config.js `define` — see BuildMarker.
        __BUILD_SHA__: 'readonly',
        __BUILT_AT__:  'readonly',
      },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
