#!/usr/bin/env bash
set -euo pipefail

WEB_DAV_URL="${READEST_WEBDAV_URL:-${WEBDAV_URL:-}}"
WEB_DAV_USERNAME="${READEST_WEBDAV_USERNAME:-${WEBDAV_USERNAME:-}}"
WEB_DAV_PASSWORD="${READEST_WEBDAV_PASSWORD:-${WEBDAV_PASSWORD:-}}"
REPOS="${REPOS:-CastaliaInstitute/scriptorium CastaliaInstitute/Bibliotech AtelierNymphet/AtelierNymphet}"

require_value() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "::error::$name is required."
    exit 1
  fi
}

require_value READEST_WEBDAV_URL "$WEB_DAV_URL"
require_value READEST_WEBDAV_USERNAME "$WEB_DAV_USERNAME"
require_value READEST_WEBDAV_PASSWORD "$WEB_DAV_PASSWORD"

if ! command -v gh >/dev/null 2>&1; then
  echo "::error::gh CLI is required."
  exit 1
fi

echo "Updating Readest WebDAV GitHub secrets."
for repo in $REPOS; do
  gh secret set READEST_WEBDAV_URL --repo "$repo" --body "$WEB_DAV_URL" >/dev/null
  gh secret set READEST_WEBDAV_USERNAME --repo "$repo" --body "$WEB_DAV_USERNAME" >/dev/null
  gh secret set READEST_WEBDAV_PASSWORD --repo "$repo" --body "$WEB_DAV_PASSWORD" >/dev/null
  echo "Updated WebDAV secrets for $repo"
done

echo "GitHub WebDAV secret sync complete."
