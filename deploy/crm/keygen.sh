#!/usr/bin/env bash
# ============================================================================
# keygen.sh — create or rotate one client's API key for the Hiraia CRM API. Run ON the
# origin host as root (install.sh calls it; rerun it to rotate).
#
#   /opt/hiraia-crm/keygen.sh <client-name> <read|write> [--rotate]
#
# What it does, and what it deliberately never does:
#   * generates a 256-bit random key   hcrm_<client>_<43 base64url chars>
#   * stores ONLY its SHA-256 in the service env file, by name:
#         /etc/hiraia-crm/crm.env:  HIRAIA_CRM_CLIENT_<CLIENT>=<scope>:sha256:<hex>
#     (client "mbp-harvestd" -> variable HIRAIA_CRM_CLIENT_MBP_HARVESTD)
#   * writes the plaintext ONCE to a root-only pickup file, /root/hiraia-crm-secrets/<client>.key,
#     for the operator to move into the client's secret store (MBP keychain / bot env). Shred it
#     after pickup. The service user cannot read /root.
#   * prints the fingerprint (first 12 hex of the hash) — never the key — and restarts the service.
# Repeatable: the same command with --rotate replaces the hash and the pickup file.
# ============================================================================
set -euo pipefail
CONF_DIR=${HIRAIA_CRM_CONF_DIR:-/etc/hiraia-crm}
ENV_FILE=$CONF_DIR/crm.env
PICKUP_DIR=${HIRAIA_CRM_PICKUP_DIR:-/root/hiraia-crm-secrets}
SERVICE=${HIRAIA_CRM_SERVICE:-hiraia-crm.service}

client=${1:-}; scope=${2:-}; rotate=0
[ "${3:-}" = "--rotate" ] && rotate=1
if ! [[ "$client" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]]; then echo "usage: keygen.sh <client-name: lower-case, digits, dashes> <read|write> [--rotate]" >&2; exit 2; fi
if [ "$scope" != read ] && [ "$scope" != write ]; then echo "scope must be read or write" >&2; exit 2; fi
var="HIRAIA_CRM_CLIENT_$(echo "$client" | tr 'a-z-' 'A-Z_')"

mkdir -p "$CONF_DIR"; touch "$ENV_FILE"; chmod 640 "$ENV_FILE"
if grep -q "^${var}=" "$ENV_FILE" && [ "$rotate" = 0 ]; then
  cur=$(grep "^${var}=" "$ENV_FILE" | sed -E 's/.*sha256:([0-9a-f]{12}).*/\1/')
  echo "$client: already configured (fingerprint $cur); pass --rotate to replace it"
  exit 0
fi

key="hcrm_$(echo "$client" | tr -d '-')_$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')"
hash=$(printf '%s' "$key" | sha256sum | cut -d' ' -f1)

tmp=$(mktemp "$CONF_DIR/.crm.env.XXXXXX")
grep -v "^${var}=" "$ENV_FILE" > "$tmp" || true
printf '%s=%s:sha256:%s\n' "$var" "$scope" "$hash" >> "$tmp"
chown root:"${HIRAIA_CRM_USER:-hiraia}" "$tmp"; chmod 640 "$tmp"; mv "$tmp" "$ENV_FILE"

umask 077
mkdir -p "$PICKUP_DIR"; chmod 700 "$PICKUP_DIR"
printf '%s\n' "$key" > "$PICKUP_DIR/$client.key"
unset key

if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then systemctl restart "$SERVICE"; fi
echo "$client: $scope key $( [ "$rotate" = 1 ] && echo rotated || echo created ) (fingerprint ${hash:0:12})"
echo "  hash stored in   $ENV_FILE as $var"
echo "  plaintext pickup $PICKUP_DIR/$client.key  (root-only; shred -u after moving it to the client)"
