#!/usr/bin/env bash
# lusso.com.au DNS verifier.
#
#   ./verify-dns.sh                    check the zone's authoritative servers
#   ./verify-dns.sh <nameserver>       check one nameserver directly
#
# Before a nameserver change, pass the new provider's nameserver to prove the
# zone answers correctly while the old one is still live. After the change,
# run it bare.
#
# It never trusts the system resolver for the verdict. A stale local cache
# reporting the old nameservers mid-cutover looks exactly like a failed
# cutover, and that is a bad thing to see when you are holding your breath.
#
# Checks run mail-first.

set -uo pipefail

PUBLIC_RESOLVER=1.1.1.1
NS="${1:-}"

if [ -z "$NS" ]; then
  # Ground truth: ask the parent delegation, not whatever we have cached.
  NS=$(dig "@$PUBLIC_RESOLVER" +short NS lusso.com.au | sort | head -1)
  if [ -z "$NS" ]; then
    echo "Could not discover authoritative nameservers for lusso.com.au. Aborting."
    exit 1
  fi
  echo "Authoritative nameserver: $NS  (discovered via $PUBLIC_RESOLVER)"
  DISCOVERED=1
else
  echo "Querying $NS directly (as instructed)"
  DISCOVERED=0
fi
DIG=(dig "@$NS" +short)
echo

PASS=0; FAIL=0; WARN=0

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; printf '        got: %s\n' "${2:-<empty>}"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; WARN=$((WARN+1)); }

check() {
  local label="$1" type="$2" name="$3" want="$4" got
  got=$("${DIG[@]}" "$type" "$name" 2>/dev/null | sort | tr '\n' ' ' | sed 's/ *$//')
  if printf '%s' "$got" | grep -Eq "$want"; then ok "$label"; else bad "$label" "$got"; fi
}

echo "── Mail (Microsoft 365) — verify first, always ──────────────────"
check "MX apex -> Outlook"        MX  lusso.com.au                  '^0 lusso-com-au\.mail\.protection\.outlook\.com\.$'
check "SPF apex unchanged (-all)" TXT lusso.com.au                  'v=spf1 include:spf\.protection\.outlook\.com -all'
check "autodiscover"              CNAME autodiscover.lusso.com.au   '^autodiscover\.outlook\.com\.$'
check "SRV Teams federation"      SRV _sipfederationtls._tcp.lusso.com.au '^100 1 5061 sipfed\.online\.lync\.com\.$'
check "SRV Teams sip"             SRV _sip._tls.lusso.com.au        '^100 1 443 sipdir\.online\.lync\.com\.$'

echo
echo "── DMARC — must be your own TXT, not the Wix CNAME ──────────────"
dmarc_cname=$("${DIG[@]}" CNAME _dmarc.lusso.com.au 2>/dev/null)
dmarc_txt=$("${DIG[@]}" TXT _dmarc.lusso.com.au 2>/dev/null | grep -F 'v=DMARC1' | tr -d '"')
if [ -n "$dmarc_cname" ]; then
  bad "_dmarc is no longer delegated to Wix" "CNAME -> $dmarc_cname"
elif [ -z "$dmarc_txt" ]; then
  bad "_dmarc policy" "<empty>"
elif printf '%s' "$dmarc_txt" | grep -q 'rua=mailto:'; then
  ok "_dmarc is your own TXT with an aggregate report address"
else
  # Valid DMARC, but with nowhere to send reports you are flying blind: no
  # visibility into who is sending as your domain, which is most of the point
  # of p=none.
  warn "_dmarc has no rua= — no aggregate reports will be delivered: $dmarc_txt"
fi

echo
echo "── Resend outbound ──────────────────────────────────────────────"
check "DKIM resend._domainkey"  TXT resend._domainkey.lusso.com.au 'p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQChW53enjumBC1ZNaisvQRxL'
check "SPF on send subdomain"   TXT send.lusso.com.au              'v=spf1 include:amazonses\.com ~all'
send_mx=$("${DIG[@]}" MX send.lusso.com.au 2>/dev/null)
if printf '%s' "$send_mx" | grep -Eq '^10 feedback-smtp\.[a-z0-9-]+\.amazonses\.com\.$'; then
  ok "MX on send subdomain ($send_mx)"
elif printf '%s' "$send_mx" | grep -q 'REGION'; then
  bad "MX send still has the REGION placeholder" "$send_mx"
else
  bad "MX send -> feedback-smtp.<region>.amazonses.com" "$send_mx"
fi
if "${DIG[@]}" TXT lusso.com.au 2>/dev/null | grep -q 'amazonses'; then
  warn "apex SPF now includes amazonses — runbook says keep it off the apex"
fi

echo
echo "── Web ──────────────────────────────────────────────────────────"
check "A apex -> Vercel"        A     lusso.com.au      '^216\.198\.79\.1$'
check "CNAME www"               CNAME www.lusso.com.au  '^cname\.vercel-dns\.com\.$'
check "CNAME app -> Pages"      CNAME app.lusso.com.au  '^lusso-7tj\.pages\.dev\.$'
check "Google verification TXT" TXT   lusso.com.au      'google-site-verification=SrSB97QrzeTlTc-BvkFFrxcRzyqDWcl2FQsBfiDvtvg'

echo
echo "── Inbound replies (phase 04) ───────────────────────────────────"
reply_mx=$("${DIG[@]}" MX reply.lusso.com.au 2>/dev/null)
if [ -n "$reply_mx" ]; then
  ok "Email Routing live on reply.lusso.com.au ($reply_mx)"
else
  warn "no MX on reply.lusso.com.au — Email Routing not enabled yet (expected until phase 04)"
fi

# Delegation, proxy state and TLS: only meaningful against the real world.
if [ "$DISCOVERED" = "1" ]; then
  echo
  echo "── Delegation, proxy state and TLS ──────────────────────────────"
  ns_public=$(dig "@$PUBLIC_RESOLVER" +short NS lusso.com.au | sort | tr '\n' ' ')
  if printf '%s' "$ns_public" | grep -q 'cloudflare'; then
    ok "nameservers on Cloudflare ($ns_public)"
  elif printf '%s' "$ns_public" | grep -q 'wixdns'; then
    warn "still on Wix nameservers ($ns_public)"
  else
    bad "nameservers" "$ns_public"
  fi

  # An out-of-date system resolver is not a fault, but unexplained it reads as
  # a failed cutover. Say so plainly instead of letting it look like one.
  ns_local=$(dig +short NS lusso.com.au | sort | tr '\n' ' ')
  if [ -n "$ns_local" ] && [ "$ns_local" != "$ns_public" ]; then
    warn "your system resolver still has the old delegation cached ($ns_local) — cosmetic, it will expire"
  fi

  # A proxied record answers on Cloudflare anycast space, not Vercel/Pages,
  # which breaks their certificate issuance.
  apex_ip=$(dig "@$PUBLIC_RESOLVER" +short A lusso.com.au | head -1)
  if [ "$apex_ip" = "216.198.79.1" ]; then ok "apex is DNS only (grey cloud)"
  else warn "apex A is $apex_ip — if that is a Cloudflare IP the record got proxied"; fi
  for h in www app; do
    t=$(dig "@$PUBLIC_RESOLVER" +short CNAME "$h.lusso.com.au")
    if [ -n "$t" ]; then ok "$h is DNS only (grey cloud)"
    else warn "$h.lusso.com.au returns no CNAME — likely proxied, which breaks TLS issuance"; fi
  done

  for host in lusso.com.au www.lusso.com.au app.lusso.com.au; do
    code=$(curl -sS -o /dev/null -m 20 -w '%{http_code}' "https://$host" 2>/dev/null)
    if [ -n "$code" ] && [ "$code" != "000" ]; then ok "https://$host -> HTTP $code"
    else bad "https://$host" "TLS or connection error — check that nothing got proxied"; fi
  done
fi

echo
printf '%d passed, %d failed, %d warnings\n' "$PASS" "$FAIL" "$WARN"
if [ "$FAIL" -gt 0 ]; then
  echo "Do not proceed while mail checks are failing."
  exit 1
fi
echo "Clean."
