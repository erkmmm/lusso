#!/bin/sh
#
# What is live, where it came from, and whether a push would break it.
#
# The question this answers is the one that is invisible otherwise: live can be
# serving a build of somebody's WORKING TREE, which no commit can reproduce. A
# "+" on the live sha means exactly that, and until those files are committed
# the next push to main takes those features off the site.

set -e
cd "$(dirname "$0")/.."

live=$(curl -fsS "https://app.lusso.com.au/version.json?nocache=$(date +%s)")
live_sha=$(printf '%s' "$live" | sed -n 's/.*"sha":"\([^"]*\)".*/\1/p')
live_at=$(printf '%s' "$live" | sed -n 's/.*"builtAt":"\([^"]*\)".*/\1/p')
head_sha=$(git rev-parse --short HEAD)

printf '\n\033[1mLive\033[0m   %s   built %s\n' "$live_sha" "$live_at"
printf '\033[1mHEAD\033[0m   %s   %s\n' "$head_sha" "$(git log -1 --format=%s | cut -c1-60)"

paths='src public index.html vite.config.js package.json package-lock.json'
dirty=$(git status --porcelain -- $paths | grep -v '^ M public/version\.json$' || true)

case "$live_sha" in
  *+)
    printf '\n\033[1;33m⚠ Live is a working-tree build.\033[0m No commit reproduces what is on the site.\n'
    if [ -n "$dirty" ]; then
      printf '  A push to main right now would take these off live:\n\n'
      printf '%s\n' "$dirty" | sed 's/^/      /'
      printf '\n  Commit them to make live reproducible. (The pre-push hook will refuse\n'
      printf '  the push until you do.)\n'
    else
      printf '  The tree is clean now, so a push would rebuild the same content.\n'
    fi
    ;;
  *)
    printf '\n\033[1;32m✓ Live came from a commit\033[0m — reproducible.\n'
    [ -n "$dirty" ] && {
      printf '  Uncommitted (not live, and will not be unless you run npm run deploy):\n\n'
      printf '%s\n' "$dirty" | sed 's/^/      /'
      printf '\n'
    }
    ;;
esac

[ "$live_sha" != "$head_sha" ] && [ "$live_sha" != "${head_sha}+" ] && \
  printf '\n  Note: live sha and HEAD differ — live is from a different commit.\n'

printf '\n'
