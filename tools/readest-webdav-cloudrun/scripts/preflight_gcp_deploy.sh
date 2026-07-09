#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-west1}"
SERVICE_NAME="${SERVICE_NAME:-readest-webdav}"

required_services=(
  run.googleapis.com
  cloudbuild.googleapis.com
  artifactregistry.googleapis.com
  secretmanager.googleapis.com
)

required_secrets=(
  supabase-url
  supabase-service-role-key
  readest-webdav-password
)

if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
fi

if [ -z "$PROJECT_ID" ]; then
  echo "::error::No Google Cloud project is configured. Set the workflow project_id input or configure a project in GCP_SERVICE_ACCOUNT_JSON."
  exit 1
fi

active_account="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' | head -n 1)"
if [ -z "$active_account" ]; then
  echo "::error::No active gcloud account after google-github-actions/auth."
  exit 1
fi

echo "Preflighting Scriptorium WebDAV deploy."
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "Service: $SERVICE_NAME"
echo "Account: $active_account"

if ! gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null; then
  echo "::error::The active account cannot access project $PROJECT_ID. Grant project access before running deploy."
  exit 1
fi

missing_services=()
for service in "${required_services[@]}"; do
  if ! gcloud services list \
    --project "$PROJECT_ID" \
    --enabled \
    --filter="config.name=$service" \
    --format='value(config.name)' | grep -Fxq "$service"; then
    missing_services+=("$service")
  fi
done

if [ "${#missing_services[@]}" -gt 0 ]; then
  echo "::error::Required Google Cloud APIs are not enabled: ${missing_services[*]}"
  echo "Enable them with: gcloud services enable ${missing_services[*]} --project $PROJECT_ID"
  exit 1
fi

missing_secrets=()
inaccessible_secret_versions=()
for secret in "${required_secrets[@]}"; do
  if ! gcloud secrets describe "$secret" --project "$PROJECT_ID" --format='value(name)' >/dev/null; then
    missing_secrets+=("$secret")
    continue
  fi
  if ! gcloud secrets versions access latest --secret "$secret" --project "$PROJECT_ID" >/dev/null; then
    inaccessible_secret_versions+=("$secret")
  fi
done

if [ "${#missing_secrets[@]}" -gt 0 ]; then
  echo "::error::Required Secret Manager secrets are missing or inaccessible: ${missing_secrets[*]}"
  exit 1
fi

if [ "${#inaccessible_secret_versions[@]}" -gt 0 ]; then
  echo "::error::The active account cannot access latest versions for secrets: ${inaccessible_secret_versions[*]}"
  exit 1
fi

if ! gcloud run services list \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(metadata.name)' >/dev/null; then
  echo "::error::The active account cannot list Cloud Run services in $PROJECT_ID/$REGION."
  exit 1
fi

if gcloud run services describe "$SERVICE_NAME" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(metadata.name)' >/dev/null 2>&1; then
  echo "Cloud Run service exists and is readable: $SERVICE_NAME"
else
  echo "Cloud Run service does not exist yet or is not readable; deploy will attempt to create it."
fi

echo "GCP deploy preflight passed."
