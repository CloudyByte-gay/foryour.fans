#!/usr/bin/env bash
# Push the `github_actions_setup` Terraform output into the GitHub repo as
# Actions secrets + variables, so .github/workflows/build.yml can run.
#
# Prereqs: `terraform apply` has run (enable_github_wif = true), plus the
# `gh` CLI authenticated with repo admin (`gh auth login`).
#
# Usage (from infrastructure/gcp/terraform/):
#   ./scripts/sync-github-actions-config.sh                 # repo = github_repo tf var
#   ./scripts/sync-github-actions-config.sh owner/repo      # explicit repo
#
# Idempotent: re-run after the first deploy to refresh API_INTERNAL_URL.
set -euo pipefail

cd "$(dirname "$0")/.."

REPO="${1:-$(terraform console <<<'var.github_repo' | tr -d '"')}"
echo "Target repo: $REPO"

JSON="$(terraform output -json github_actions_setup)"
if [[ "$JSON" == "null" ]]; then
  echo "github_actions_setup is null — set enable_github_wif = true and apply first." >&2
  exit 1
fi

get() { jq -r --arg k "$1" '.[$k]' <<<"$JSON"; }

# Secrets: the WIF provider resource name + the CI service-account email.
for k in GCP_PROVIDER GCP_SA_EMAIL; do
  v="$(get "$k")"
  echo "secret   $k"
  gh secret set "$k" --repo "$REPO" --body "$v"
done

# Variables: everything else. API_INTERNAL_URL may be "" before the first
# deploy — that's fine, the web image just falls back to its Dockerfile default.
for k in GCP_REGION AR_REPO SITE_URL API_INTERNAL_URL; do
  v="$(get "$k")"
  echo "variable $k = ${v:-<empty>}"
  gh variable set "$k" --repo "$REPO" --body "$v"
done

echo "Done. Trigger a build:  gh workflow run build.yml --repo $REPO"
