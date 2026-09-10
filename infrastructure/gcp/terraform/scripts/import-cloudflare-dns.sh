#!/usr/bin/env bash
# One-off: adopt the pre-existing Cloud Run domain-mapping DNS records in
# Cloudflare into Terraform state, so `cloudflare_dns_record.web` manages them
# instead of trying to re-create them (API error 81058 "identical record
# already exists").
#
# Usage, from infrastructure/gcp/terraform:
#   export TF_VAR_cloudflare_api_token=...      # Zone:Read + DNS:Edit
#   ./scripts/import-cloudflare-dns.sh <zone_id> <domain>
#   ./scripts/import-cloudflare-dns.sh ba994e8ffc88aca32573ea3f8edeaa8e foryour.fans
#
# Re-runnable: `terraform import` is a no-op for already-imported addresses.
set -euo pipefail

ZONE_ID="${1:?zone id required}"
DOMAIN="${2:?domain (record name) required}"
TOKEN="${TF_VAR_cloudflare_api_token:?export TF_VAR_cloudflare_api_token first}"

cd "$(dirname "$0")/.."

# Google's fixed Cloud Run / App Engine custom-domain targets.
declare -a WANT=(
  "A|216.239.32.21" "A|216.239.34.21" "A|216.239.36.21" "A|216.239.38.21"
  "AAAA|2001:4860:4802:32::15" "AAAA|2001:4860:4802:34::15"
  "AAAA|2001:4860:4802:36::15" "AAAA|2001:4860:4802:38::15"
  "CNAME|ghs.googlehosted.com"
)

records_json="$(curl -sf \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${DOMAIN}&per_page=100")"

for entry in "${WANT[@]}"; do
  type="${entry%%|*}"
  content="${entry##*|}"

  rid="$(printf '%s' "$records_json" | jq -r \
    --arg t "$type" --arg c "$content" --arg c2 "${content}." \
    '.result[] | select(.type == $t and (.content == $c or .content == $c2)) | .id' | head -n1)"

  addr="cloudflare_dns_record.web[\"${type}-${content}\"]"

  if [[ -z "$rid" || "$rid" == "null" ]]; then
    echo "skip  ${type} ${content} — not present in zone"
    continue
  fi

  echo "import ${addr}  <-  ${ZONE_ID}/${rid}"
  terraform import "$addr" "${ZONE_ID}/${rid}"
done

echo
echo "Done. Now run: terraform plan   (expect: no changes, or in-place comment/ttl tweaks)"
