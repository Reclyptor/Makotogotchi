#!/usr/bin/env bash
# Cloudflare configuration for Makotogotchi (SPEC §19) — idempotent, safe to
# re-run. Requires CLOUDFLARE_API_TOKEN with: Account:Cloudflare Tunnel:Edit,
# and Zone:DNS:Edit + Zone Settings:Edit + Cache Rules:Edit + Zone WAF:Edit
# on makotogotchi.com and reclyptor.com.
#
#   ./scripts/cloudflare-setup.sh            # apply
#   ./scripts/cloudflare-setup.sh --dry-run  # print intended changes only
#
# What it configures:
#   1. Tunnel public hostnames (MERGED into the existing tunnel config —
#      routes for other apps are preserved) → the in-cluster service
#   2. Proxied CNAMEs for makotogotchi.com, www, makoto.reclyptor.com
#   3. A cache rule bypassing /api/* (a cached SSE stream is a broken one)
#   4. A rate-limit rule: 60 req/min per IP on /api/care
#   5. Always Use HTTPS on both zones
#
# NOT automatable (do in the dashboard): Bot Fight Mode must be OFF for
# both zones — every visitor is anonymous by design, and a bot challenge on
# the action endpoint would break the product.

set -euo pipefail

TUNNEL_ID="414c90a2-c38a-46b2-9d6b-53670c4dfc3f"
SERVICE="http://makotogotchi.makotogotchi.svc.cluster.local:3000"
HOSTNAMES=("makotogotchi.com" "www.makotogotchi.com" "makoto.reclyptor.com")
API="https://api.cloudflare.com/client/v4"

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set — see SPEC §19.1}"

cf() {
  local method=$1 path=$2 body=${3:-}
  if [[ -n "$body" ]]; then
    curl -sf -X "$method" "$API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "$body"
  else
    curl -sf -X "$method" "$API$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  fi
}

zone_id() {
  cf GET "/zones?name=$1" | jq -r '.result[0].id // empty'
}

account_id() {
  cf GET "/accounts" | jq -r '.result[0].id // empty'
}

echo "── resolving ids ──"
ACCOUNT=$(account_id)
ZONE_MGC=$(zone_id "makotogotchi.com")
ZONE_REC=$(zone_id "reclyptor.com")
[[ -n "$ACCOUNT" && -n "$ZONE_MGC" && -n "$ZONE_REC" ]] || {
  echo "missing account/zone access — check the token's scopes" >&2
  exit 1
}
echo "account=$ACCOUNT zone(makotogotchi.com)=$ZONE_MGC zone(reclyptor.com)=$ZONE_REC"

# ── 1. Tunnel public hostnames (merge, never replace) ──────────────────────
echo "── tunnel config ──"
CURRENT=$(cf GET "/accounts/$ACCOUNT/cfd_tunnel/$TUNNEL_ID/configurations" | jq '.result.config // {ingress: []}')
MERGED=$CURRENT
for host in "${HOSTNAMES[@]}"; do
  if echo "$CURRENT" | jq -e --arg h "$host" '.ingress[]? | select(.hostname == $h)' >/dev/null; then
    echo "  $host: already routed"
  else
    echo "  $host: adding → $SERVICE"
    MERGED=$(echo "$MERGED" | jq --arg h "$host" --arg s "$SERVICE" \
      '.ingress = ([.ingress[]? | select(.service != "http_status:404")] + [{hostname: $h, service: $s}] + [{service: "http_status:404"}])')
  fi
done
if [[ "$MERGED" != "$CURRENT" ]]; then
  if $DRY_RUN; then
    echo "  DRY RUN — would PUT tunnel config:"
    echo "$MERGED" | jq '.ingress'
  else
    cf PUT "/accounts/$ACCOUNT/cfd_tunnel/$TUNNEL_ID/configurations" "{\"config\": $MERGED}" | jq -r '"  updated (version " + (.result.version|tostring) + ")"'
  fi
fi

# ── 2. DNS: proxied CNAMEs to the tunnel ───────────────────────────────────
echo "── dns ──"
dns_upsert() {
  local zone=$1 name=$2
  local existing
  existing=$(cf GET "/zones/$zone/dns_records?type=CNAME&name=$name" | jq -r '.result[0].id // empty')
  local body="{\"type\":\"CNAME\",\"name\":\"$name\",\"content\":\"$TUNNEL_ID.cfargotunnel.com\",\"proxied\":true,\"ttl\":1}"
  if $DRY_RUN; then
    echo "  DRY RUN — would upsert CNAME $name (existing: ${existing:-none})"
  elif [[ -n "$existing" ]]; then
    cf PUT "/zones/$zone/dns_records/$existing" "$body" >/dev/null && echo "  $name: updated"
  else
    cf POST "/zones/$zone/dns_records" "$body" >/dev/null && echo "  $name: created"
  fi
}
dns_upsert "$ZONE_MGC" "makotogotchi.com"
dns_upsert "$ZONE_MGC" "www.makotogotchi.com"
dns_upsert "$ZONE_REC" "makoto.reclyptor.com"

# ── 3. Cache rule: bypass /api/* ───────────────────────────────────────────
echo "── cache bypass ──"
cache_rule() {
  local zone=$1 host=$2
  local ruleset
  ruleset=$(cf GET "/zones/$zone/rulesets/phases/http_request_cache_settings/entrypoint" 2>/dev/null | jq -r '.result.id // empty')
  local expr="(http.host eq \"$host\" and starts_with(http.request.uri.path, \"/api/\"))"
  local rule="{\"action\":\"set_cache_settings\",\"expression\":$(jq -Rn --arg e "$expr" '$e'),\"description\":\"makotogotchi: never cache the API or the SSE stream\",\"action_parameters\":{\"cache\":false}}"
  if [[ -n "$ruleset" ]] && cf GET "/zones/$zone/rulesets/$ruleset" | jq -e '.result.rules[]? | select(.description == "makotogotchi: never cache the API or the SSE stream")' >/dev/null; then
    echo "  $host: cache bypass already present"
    return
  fi
  if $DRY_RUN; then
    echo "  DRY RUN — would add cache-bypass rule on $host"
  elif [[ -n "$ruleset" ]]; then
    cf POST "/zones/$zone/rulesets/$ruleset/rules" "$rule" >/dev/null && echo "  $host: cache bypass added"
  else
    cf POST "/zones/$zone/rulesets" "{\"name\":\"default\",\"kind\":\"zone\",\"phase\":\"http_request_cache_settings\",\"rules\":[$rule]}" >/dev/null && echo "  $host: cache ruleset created"
  fi
}
cache_rule "$ZONE_MGC" "makotogotchi.com"
cache_rule "$ZONE_REC" "makoto.reclyptor.com"

# ── 4. Rate limit: /api/care 60/min per IP ─────────────────────────────────
echo "── rate limit ──"
ratelimit_rule() {
  local zone=$1 host=$2
  local ruleset
  ruleset=$(cf GET "/zones/$zone/rulesets/phases/http_ratelimit/entrypoint" 2>/dev/null | jq -r '.result.id // empty')
  local expr="(http.host eq \"$host\" and http.request.uri.path eq \"/api/care\")"
  local rule="{\"action\":\"block\",\"expression\":$(jq -Rn --arg e "$expr" '$e'),\"description\":\"makotogotchi: care action rate limit\",\"ratelimit\":{\"characteristics\":[\"ip.src\",\"cf.colo.id\"],\"period\":60,\"requests_per_period\":60,\"mitigation_timeout\":60}}"
  if [[ -n "$ruleset" ]] && cf GET "/zones/$zone/rulesets/$ruleset" | jq -e '.result.rules[]? | select(.description == "makotogotchi: care action rate limit")' >/dev/null; then
    echo "  $host: rate limit already present"
    return
  fi
  if $DRY_RUN; then
    echo "  DRY RUN — would add rate-limit rule on $host"
  elif [[ -n "$ruleset" ]]; then
    cf POST "/zones/$zone/rulesets/$ruleset/rules" "$rule" >/dev/null && echo "  $host: rate limit added"
  else
    cf POST "/zones/$zone/rulesets" "{\"name\":\"default\",\"kind\":\"zone\",\"phase\":\"http_ratelimit\",\"rules\":[$rule]}" >/dev/null && echo "  $host: rate-limit ruleset created"
  fi
}
ratelimit_rule "$ZONE_MGC" "makotogotchi.com"
ratelimit_rule "$ZONE_REC" "makoto.reclyptor.com"

# ── 5. Always Use HTTPS ────────────────────────────────────────────────────
echo "── https ──"
for zone in "$ZONE_MGC" "$ZONE_REC"; do
  if $DRY_RUN; then
    echo "  DRY RUN — would enable always_use_https on $zone"
  else
    cf PATCH "/zones/$zone/settings/always_use_https" '{"value":"on"}' >/dev/null && echo "  $zone: always_use_https on"
  fi
done

echo
echo "Done. Remaining manual step: turn Bot Fight Mode OFF for both zones"
echo "(dashboard → Security → Bots) — there is no API for it."
