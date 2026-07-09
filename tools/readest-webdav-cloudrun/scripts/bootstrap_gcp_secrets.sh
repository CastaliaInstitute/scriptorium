#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi

if [ -z "$PROJECT_ID" ]; then
  echo "::error::No Google Cloud project is configured. Set PROJECT_ID or run gcloud config set project."
  exit 1
fi

require_env() {
  local key="$1"
  if [ -z "${!key:-}" ]; then
    echo "::error::$key is required but is not set."
    exit 1
  fi
}

ensure_secret_version() {
  local secret_name="$1"
  local value="$2"

  if gcloud secrets describe "$secret_name" --project "$PROJECT_ID" --format='value(name)' >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$secret_name" \
      --project "$PROJECT_ID" \
      --data-file=- >/dev/null
    echo "Added new version for Secret Manager secret: $secret_name"
  else
    printf '%s' "$value" | gcloud secrets create "$secret_name" \
      --project "$PROJECT_ID" \
      --replication-policy=automatic \
      --data-file=- >/dev/null
    echo "Created Secret Manager secret: $secret_name"
  fi
}

require_env SUPABASE_URL
require_env SUPABASE_SERVICE_ROLE_KEY
require_env WEBDAV_PASSWORD

echo "Bootstrapping Scriptorium WebDAV secrets in project: $PROJECT_ID"
ensure_secret_version "supabase-url" "$SUPABASE_URL"
ensure_secret_version "supabase-service-role-key" "$SUPABASE_SERVICE_ROLE_KEY"
ensure_secret_version "readest-webdav-password" "$WEBDAV_PASSWORD"
echo "Secret bootstrap complete."
