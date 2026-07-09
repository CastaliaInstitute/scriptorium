#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_EMAIL:-}"
APPLY="${APPLY:-false}"

required_roles=(
  roles/run.admin
  roles/cloudbuild.builds.editor
  roles/artifactregistry.admin
  roles/secretmanager.admin
  roles/serviceusage.serviceUsageAdmin
  roles/iam.serviceAccountUser
)

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi

if [ -z "$PROJECT_ID" ]; then
  echo "::error::No Google Cloud project is configured. Set PROJECT_ID or run gcloud config set project."
  exit 1
fi

if [ -z "$SERVICE_ACCOUNT_EMAIL" ]; then
  echo "::error::SERVICE_ACCOUNT_EMAIL is required."
  exit 1
fi

member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}"
echo "Checking Scriptorium WebDAV deploy IAM."
echo "Project: $PROJECT_ID"
echo "Service account: $SERVICE_ACCOUNT_EMAIL"

if ! gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null; then
  echo "::error::The active account cannot access project $PROJECT_ID."
  exit 1
fi

missing_roles=()
for role in "${required_roles[@]}"; do
  if gcloud projects get-iam-policy "$PROJECT_ID" \
    --flatten='bindings[].members' \
    --filter="bindings.role=$role AND bindings.members=$member" \
    --format='value(bindings.role)' | grep -Fxq "$role"; then
    echo "Present: $role"
  else
    echo "Missing: $role"
    missing_roles+=("$role")
  fi
done

if [ "${#missing_roles[@]}" -eq 0 ]; then
  echo "All required deploy roles are present."
  exit 0
fi

if [ "$APPLY" != "true" ]; then
  echo "::warning::Missing deploy roles: ${missing_roles[*]}"
  echo "Re-run with APPLY=true to grant them."
  exit 1
fi

for role in "${missing_roles[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "$member" \
    --role "$role" \
    --condition=None >/dev/null
  echo "Granted: $role"
done

echo "IAM bootstrap complete."
