#!/bin/zsh
TASK_ROOT="/Users/jett/lusso"
TASK_NODE="/Users/jett/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$TASK_NODE" ]]; then
  TASK_NODE="$(command -v node)"
fi
if [[ -z "$TASK_NODE" ]]; then
  print 'Node.js is missing. Ask for help setting up the Lusso quote assistant.'
  read -k 1
  exit 1
fi
cd "$TASK_ROOT" || exit 1
exec "$TASK_NODE" mac-assistant/server.mjs
