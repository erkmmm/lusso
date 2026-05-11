#!/bin/bash
set -e

# Install dependencies
npm install

# On Linux, explicitly install the matching rolldown native binding
# (Cloudflare Pages doesn't auto-install platform-specific optional deps)
if [[ "$(uname)" == "Linux" ]]; then
  ROLLDOWN_BINDING_VERSION=$(node -p "require('./node_modules/rolldown/package.json').optionalDependencies['@rolldown/binding-linux-x64-gnu']")
  echo "Installing @rolldown/binding-linux-x64-gnu@${ROLLDOWN_BINDING_VERSION}"
  npm install --no-save "@rolldown/binding-linux-x64-gnu@${ROLLDOWN_BINDING_VERSION}"
fi

# Build
npm run build
