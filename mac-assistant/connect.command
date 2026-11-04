#!/bin/zsh
TASK_WORKSPACE="$HOME/Library/Application Support/Lusso Quote Assistant/workspace"
mkdir -p "$TASK_WORKSPACE"
cd "$TASK_WORKSPACE" || exit 1
print 'Sign in to Claude Code if prompted. Then enter /chrome to connect Chrome.'
print 'Allow only Lusso, BUZ and FHA for quoting. Return to Lusso and check the connection.'
exec /Users/jett/homebrew/bin/claude --chrome
