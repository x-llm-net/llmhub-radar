#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_ENV_FILE=.env.images
COMPOSE_FILES=(-f docker-compose.radar.yaml -f docker-compose.radar.images.yaml)
COMPOSE=(docker compose --env-file "$COMPOSE_ENV_FILE" "${COMPOSE_FILES[@]}")

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
}

validate_image_tag() {
  if [[ ! "$LLMHUB_RADAR_IMAGE_TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "Invalid Docker image tag: $LLMHUB_RADAR_IMAGE_TAG" >&2
    exit 2
  fi
}

write_compose_env() {
  {
    printf 'LLMHUB_RADAR_IMAGE_REGISTRY=%s\n' "${LLMHUB_RADAR_IMAGE_REGISTRY:-ghcr.io}"
    printf 'LLMHUB_RADAR_IMAGE_OWNER=%s\n' "$LLMHUB_RADAR_IMAGE_OWNER"
    printf 'LLMHUB_RADAR_IMAGE_TAG=%s\n' "$LLMHUB_RADAR_IMAGE_TAG"
  } >"$COMPOSE_ENV_FILE"
}

backup_database() {
  local backup_dir="${LLMHUB_RADAR_BACKUP_DIR:-/opt/backups/llmhub-radar}"
  local backup_file
  local libsql_container="${LLMHUB_RADAR_LIBSQL_CONTAINER:-llmhub-radar-libsql}"
  local paused_libsql=0
  local backup_status=0
  backup_file="${backup_dir}/libsql-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

  mkdir -p "$backup_dir"
  if [ "$(docker inspect -f '{{.State.Running}}' "$libsql_container" 2>/dev/null || true)" = "true" ]; then
    docker pause "$libsql_container" >/dev/null
    paused_libsql=1
  fi

  restore_libsql() {
    if [ "$paused_libsql" = "1" ]; then
      docker unpause "$libsql_container" >/dev/null || true
      paused_libsql=0
    fi
  }
  trap restore_libsql RETURN

  docker run --rm \
    -v llmhub-radar-libsql-data:/data:ro \
    -v "$backup_dir:/backup" \
    ubuntu:24.04 \
    tar czf "/backup/$(basename "$backup_file")" -C /data . || backup_status=$?

  restore_libsql
  trap - RETURN

  if [ "$backup_status" -ne 0 ]; then
    echo "Failed to create backup: $backup_file" >&2
    return "$backup_status"
  fi

  echo "Created backup: $backup_file"
}

wait_for_container_healthy() {
  local container="$1"
  local attempt
  local health

  for attempt in $(seq 1 24); do
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"
    if [ "$health" = "healthy" ] || [ "$health" = "running" ]; then
      return 0
    fi
    echo "Waiting for $container to become healthy, attempt $attempt/24, status=${health:-missing}"
    sleep 5
  done

  echo "Container $container did not become healthy after 24 attempts" >&2
  return 1
}

validate_compose() {
  "${COMPOSE[@]}" config --quiet
}

smoke_test() {
  local dashboard_url="${LLMHUB_RADAR_LOCAL_DASHBOARD_URL:-http://127.0.0.1:3000/}"
  local status_page_url="${LLMHUB_RADAR_LOCAL_STATUS_PAGE_URL:-http://127.0.0.1:3001/}"

  smoke_test_url "$dashboard_url"
  smoke_test_url "$status_page_url"
  echo "Smoke tests passed: $dashboard_url $status_page_url"
}

smoke_test_url() {
  local url="$1"
  local attempt
  local code

  for attempt in $(seq 1 24); do
    code="$(curl -sS -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)"
    if [[ "$code" =~ ^[23][0-9][0-9]$ ]]; then
      return 0
    fi
    echo "Smoke test waiting for $url, attempt $attempt/24, code=${code:-curl_failed}"
    sleep 5
  done

  echo "Smoke test failed for $url after 24 attempts" >&2
  return 1
}

require_env LLMHUB_RADAR_IMAGE_OWNER
require_env LLMHUB_RADAR_IMAGE_TAG
validate_image_tag

if [ ! -f .env.radar ]; then
  echo "Missing .env.radar in $(pwd)" >&2
  exit 2
fi

write_compose_env
validate_compose

if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

echo "Deploying LLMHub Radar image tag: ${LLMHUB_RADAR_IMAGE_TAG}"

"${COMPOSE[@]}" pull dashboard status-page radar-probe-worker db-migrate

backup_database

"${COMPOSE[@]}" up -d libsql
wait_for_container_healthy "${LLMHUB_RADAR_LIBSQL_CONTAINER:-llmhub-radar-libsql}"
"${COMPOSE[@]}" up \
  --no-deps \
  --force-recreate \
  --abort-on-container-exit \
  --exit-code-from db-migrate \
  db-migrate
"${COMPOSE[@]}" up -d --no-build dashboard status-page radar-probe-worker

smoke_test

if [ "${RADAR_DEPLOY_NOTIFICATIONS:-0}" = "1" ]; then
  "${COMPOSE[@]}" run --rm radar-probe-worker bun src/scripts/radar-notification-preflight.ts
  "${COMPOSE[@]}" --profile notifications pull radar-notification-worker
  "${COMPOSE[@]}" --profile notifications up -d --no-build radar-notification-worker
else
  echo "Notification worker was not restarted. Set RADAR_DEPLOY_NOTIFICATIONS=1 after reviewing notification risk."
fi

"${COMPOSE[@]}" ps
