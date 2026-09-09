#!/usr/bin/env bash
#
# Set the edge-function secrets for the Lusso content pipeline.
#
# Prompts for each value with input hidden, so nothing reaches shell history,
# this file, or a transcript. Blank input skips that secret, so the script is
# safe to re-run to fill in one you did not have to hand.
#
# It only asks for the secrets the CONTENT pipeline needs and this project does
# not already have. Everything else — ANTHROPIC_API_KEY, SEO_REPO_TOKEN, the
# Twilio, Xero and Resend values — was set long ago and is deliberately not
# re-prompted: an accidental Enter on a working secret is a broken integration,
# and there is nothing to gain from asking again. `--check` lists what is set
# without touching anything.
#
#     ./scripts/set-secrets.sh            # prompt for what is missing
#     ./scripts/set-secrets.sh --check    # report only, set nothing
#     ./scripts/set-secrets.sh SEMRUSH_API_KEY   # set just one, and test it
set -euo pipefail

REF=wwompnqglvdxcmjquuzr
SILL_REF=hsivppdfgofvdijyyfje
[ "$REF" != "$SILL_REF" ] || { echo "Refusing: target is Sill."; exit 1; }

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v supabase >/dev/null 2>&1 || export PATH="/Users/jett/homebrew/bin:$PATH"
command -v supabase >/dev/null 2>&1 || {
  echo "supabase CLI not found. brew install supabase/tap/supabase"; exit 1; }

# The callback Meta redirects back to. Written out rather than left to be typed:
# a single character wrong here fails at the end of the OAuth round trip, where
# it looks like Meta's problem rather than a typo.
META_CALLBACK="https://${REF}.supabase.co/functions/v1/meta-oauth-callback"

# Higgsfield authenticates with a PAIR -- `Authorization: Key <id>:<secret>` --
# so both halves are asked for by name. An earlier single HIGGSFIELD_API_KEY was
# ambiguous about which half it held, and a wrong guess returns a flat
# 401 "Invalid credentials" that says nothing about which value is missing.
declare -a NAMES=(
  "HIGGSFIELD_API_KEY_ID|content-write — generates the photos on a page|the KEY ID half, from your Higgsfield API keys page"
  "HIGGSFIELD_API_KEY_SECRET|content-write — generates the photos on a page|the SECRET half, shown beside the ID when the key was created"
  "SEMRUSH_API_KEY|keyword refresh|semrush.com → your avatar → Subscription info → API units → the key shown there. NOT the MCP token and NOT your login — a wrong one returns ERROR 122."
  "META_APP_ID|meta-oauth-start/callback|developers.facebook.com → your app → Settings → Basic"
  "META_APP_SECRET|meta-oauth-callback|same page as the App ID"
  "META_REDIRECT_URI|meta-oauth-start/callback|MUST be exactly: ${META_CALLBACK}"
)

# ── Report what is already there ────────────────────────────────────────────
echo "Lusso ($REF) — content pipeline secrets."
echo
HAVE=$(supabase secrets list --project-ref "$REF" 2>/dev/null \
  | python3 -c 'import sys,json;print(" ".join(s["name"] for s in json.load(sys.stdin)["secrets"]))' \
  2>/dev/null || echo "")

for entry in "${NAMES[@]}"; do
  IFS='|' read -r name _ _ <<< "$entry"
  case " $HAVE " in
    *" $name "*) printf '  %-20s already set\n' "$name" ;;
    *)           printf '  %-20s missing\n'     "$name" ;;
  esac
done
echo

if [ "${1:-}" = "--check" ]; then exit 0; fi

# Setting one named secret, rather than being walked through all six. The
# Semrush key in particular gets re-entered on its own, because a wrong value
# fails silently until the next weekly sync.
ONLY="${1:-}"
if [ -n "$ONLY" ]; then
  FOUND=""
  for entry in "${NAMES[@]}"; do
    IFS='|' read -r name _ _ <<< "$entry"
    [ "$name" = "$ONLY" ] && FOUND=1
  done
  if [ -z "$FOUND" ]; then
    echo "No secret called $ONLY. Run without arguments to see the list." >&2
    exit 1
  fi
fi

echo "Press Enter to skip any you do not have yet."
echo "A secret that is already set is left alone unless you type a new value."
echo

SET_COUNT=0
for entry in "${NAMES[@]}"; do
  IFS='|' read -r name used note <<< "$entry"
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  printf '%s\n  used by: %s\n' "$name" "$used"
  [ -n "$note" ] && printf '  note: %s\n' "$note"
  printf '  value (hidden, Enter to skip): '
  read -rs val; printf '\n\n'
  if [ -n "$val" ]; then
    supabase secrets set "$name=$val" --project-ref "$REF" >/dev/null
    # Prove the key works before anyone waits a week for the sync to tell them.
    # A live call is the only thing that distinguishes a good key from a
    # plausible-looking one; the value is used here and never printed.
    if [ "$name" = "SEMRUSH_API_KEY" ]; then
      printf '  testing the key against api.semrush.com ... '
      RESP=$(curl -s --max-time 20 \
        "https://api.semrush.com/?type=phrase_this&key=${val}&phrase=blinds&database=au&export_columns=Ph,Nq" \
        | head -2)
      case "$RESP" in
        ERROR*) printf 'REJECTED\n    %s\n' "$(printf '%s' "$RESP" | head -1)" ;;
        "")     printf 'no response — check your connection\n' ;;
        *)      printf 'works\n' ;;
      esac
    fi
    unset val
    SET_COUNT=$((SET_COUNT+1))
  fi
done

echo "Set $SET_COUNT secret(s)."
if [ "$SET_COUNT" -gt 0 ]; then
  echo
  echo "Edge functions pick up new secrets on their next cold start — no redeploy needed."
fi
echo
echo "Still to do by hand, and no key will substitute for them:"
echo "  · Meta App Review for instagram_content_publish and pages_manage_posts."
echo "    Connecting works without it; PUBLISHING does not."
echo "  · Add this exact URL to the app's Valid OAuth Redirect URIs:"
echo "      ${META_CALLBACK}"
