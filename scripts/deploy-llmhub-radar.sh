#!/usr/bin/env bash
set -Eeuo pipefail

COMPOSE_ENV_FILE=.env.images
COMPOSE_FILES=(-f docker-compose.radar.yaml -f docker-compose.radar.images.yaml)
COMPOSE=(docker compose --env-file .env.radar --env-file "$COMPOSE_ENV_FILE" "${COMPOSE_FILES[@]}")
DEPLOY_ROOT="$(pwd)"
STOREFRONT_SOURCE_DIR="${LLMHUB_RADAR_STOREFRONT_SOURCE_DIR:-$DEPLOY_ROOT/apps/storefront}"
STOREFRONT_ROOT="${LLMHUB_RADAR_STOREFRONT_ROOT:-$DEPLOY_ROOT/storefront}"
CADDY_CONFIG_SOURCE="${LLMHUB_RADAR_CADDY_CONFIG_SOURCE:-$DEPLOY_ROOT/infra/Caddyfile.radar.example}"
CADDY_CONFIG_TARGET="${LLMHUB_RADAR_CADDY_CONFIG_TARGET:-/etc/caddy/Caddyfile}"
CADDY_BACKUP_FILE=""
CADDY_HAD_PREVIOUS=0
CADDY_SWITCHED=0
STOREFRONT_PREVIOUS_TARGET=""
STOREFRONT_SWITCHED=0

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "Missing required environment variable: $name" >&2
    exit 2
  fi
}

require_env_file_value() {
  local name="$1"
  local value
  value="$(sed -n "s/^${name}=//p" .env.radar | tail -n 1)"
  if [ -z "$value" ]; then
    echo "Missing $name in .env.radar" >&2
    exit 2
  fi
  case "$value" in
    *replace* | *local-only*)
      echo "$name in .env.radar still contains a placeholder value" >&2
      exit 2
      ;;
  esac
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

backup_media() {
  local backup_dir="${LLMHUB_RADAR_BACKUP_DIR:-/opt/backups/llmhub-radar}"
  local backup_file
  backup_file="${backup_dir}/media-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"

  mkdir -p "$backup_dir"
  docker run --rm \
    -v llmhub-radar-media-data:/data:ro \
    -v "$backup_dir:/backup" \
    ubuntu:24.04 \
    tar czf "/backup/$(basename "$backup_file")" -C /data .

  echo "Created backup: $backup_file"
}

backup_marketplace_database() {
  local backup_dir="${LLMHUB_RADAR_BACKUP_DIR:-/opt/backups/llmhub-radar}"
  local backup_file
  local container="${LLMHUB_RADAR_MARKETPLACE_POSTGRES_CONTAINER:-llmhub-radar-marketplace-postgres}"
  backup_file="${backup_dir}/marketplace-postgres-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"

  if [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" != "true" ]; then
    echo "Marketplace PostgreSQL is not running; skipping backup for first deployment."
    return 0
  fi

  mkdir -p "$backup_dir"
  docker exec "$container" sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --no-owner --no-privileges -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    | gzip -c >"$backup_file"
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

validate_storefront_source() {
  local file
  for file in \
    index.html \
    model.html \
    provider.html \
    styles.css \
    main.js \
    model-page.js \
    provider-page.js \
    dashboard-links.js \
    favicon.svg; do
    if [ ! -s "$STOREFRONT_SOURCE_DIR/$file" ]; then
      echo "Missing storefront release file: $STOREFRONT_SOURCE_DIR/$file" >&2
      return 1
    fi
  done
}

prepare_storefront_release() {
  local release_dir="$STOREFRONT_ROOT/releases/$LLMHUB_RADAR_IMAGE_TAG"
  local current_link="$STOREFRONT_ROOT/current"
  local next_link="$STOREFRONT_ROOT/.current-$LLMHUB_RADAR_IMAGE_TAG-$$"

  install -d -m 755 "$STOREFRONT_ROOT/releases"
  if [ ! -d "$release_dir" ]; then
    install -d -m 755 "$release_dir"
    cp -a "$STOREFRONT_SOURCE_DIR/." "$release_dir/"
    find "$release_dir" -type d -exec chmod 755 {} +
    find "$release_dir" -type f -exec chmod 644 {} +
  fi

  if [ -L "$current_link" ]; then
    STOREFRONT_PREVIOUS_TARGET="$(readlink "$current_link")"
  fi
  ln -s "$release_dir" "$next_link"
  mv -Tf "$next_link" "$current_link"
  STOREFRONT_SWITCHED=1
  echo "Prepared storefront release: $release_dir"
}

install_caddy_config() {
  local backup_dir="${LLMHUB_RADAR_BACKUP_DIR:-/opt/backups/llmhub-radar}"

  if [ ! -s "$CADDY_CONFIG_SOURCE" ]; then
    echo "Missing Caddy config: $CADDY_CONFIG_SOURCE" >&2
    return 1
  fi

  caddy validate --config "$CADDY_CONFIG_SOURCE" --adapter caddyfile
  install -d -m 700 "$backup_dir"
  CADDY_BACKUP_FILE="$backup_dir/Caddyfile-pre-$LLMHUB_RADAR_IMAGE_TAG-$(date -u +%Y%m%dT%H%M%SZ)"
  if [ -f "$CADDY_CONFIG_TARGET" ]; then
    cp -a "$CADDY_CONFIG_TARGET" "$CADDY_BACKUP_FILE"
    CADDY_HAD_PREVIOUS=1
  fi

  install -m 644 "$CADDY_CONFIG_SOURCE" "$CADDY_CONFIG_TARGET"
  CADDY_SWITCHED=1
  caddy validate --config "$CADDY_CONFIG_TARGET" --adapter caddyfile
  systemctl reload caddy
  echo "Installed Caddy config; backup: $CADDY_BACKUP_FILE"
}

rollback_public_routing() {
  local current_link="$STOREFRONT_ROOT/current"
  local next_link="$STOREFRONT_ROOT/.rollback-$$"

  if [ "$STOREFRONT_SWITCHED" = "1" ]; then
    if [ -n "$STOREFRONT_PREVIOUS_TARGET" ]; then
      ln -s "$STOREFRONT_PREVIOUS_TARGET" "$next_link"
      mv -Tf "$next_link" "$current_link"
    elif [ -L "$current_link" ]; then
      unlink "$current_link"
    fi
  fi

  if [ "$CADDY_SWITCHED" = "1" ]; then
    if [ "$CADDY_HAD_PREVIOUS" = "1" ]; then
      install -m 644 "$CADDY_BACKUP_FILE" "$CADDY_CONFIG_TARGET"
    elif [ -f "$CADDY_CONFIG_TARGET" ]; then
      unlink "$CADDY_CONFIG_TARGET"
    fi
    caddy validate --config "$CADDY_CONFIG_TARGET" --adapter caddyfile
    systemctl reload caddy
    echo "Restored previous public routing after deployment failure."
  fi
}

handle_error() {
  local status="$1"
  trap - ERR
  rollback_public_routing || true
  exit "$status"
}

smoke_test_local() {
  local dashboard_url="${LLMHUB_RADAR_LOCAL_DASHBOARD_URL:-http://127.0.0.1:3000/}"
  local status_page_url="${LLMHUB_RADAR_LOCAL_STATUS_PAGE_URL:-http://127.0.0.1:3001/}"
  local marketplace_health_url="${LLMHUB_RADAR_LOCAL_MARKETPLACE_HEALTH_URL:-http://127.0.0.1:3010/health}"

  smoke_test_url "$dashboard_url"
  smoke_test_url "$status_page_url"
  smoke_test_url "$marketplace_health_url"
  echo "Local smoke tests passed: $dashboard_url $status_page_url $marketplace_health_url"
}

smoke_test_public() {
  local marketplace_public_url="${LLMHUB_RADAR_PUBLIC_MARKETPLACE_URL:-https://llm-hub.store/v1/models}"
  local homepage_api_url="${LLMHUB_RADAR_PUBLIC_HOMEPAGE_API_URL:-https://llm-hub.store/v1/homepage}"
  local storefront_url="${LLMHUB_RADAR_PUBLIC_STOREFRONT_URL:-https://llm-hub.store/}"

  smoke_test_url "$marketplace_public_url"
  smoke_test_url "$homepage_api_url"
  smoke_test_url "${storefront_url%/}/model.html"
  smoke_test_url "${storefront_url%/}/provider.html"
  smoke_test_content "$storefront_url" "LLMHub Marketplace"
  echo "Public smoke tests passed: $marketplace_public_url $homepage_api_url $storefront_url"
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

smoke_test_content() {
  local url="$1"
  local expected="$2"
  local attempt
  local body

  for attempt in $(seq 1 24); do
    body="$(curl -fsS "$url" 2>/dev/null || true)"
    if [[ "$body" == *"$expected"* ]]; then
      return 0
    fi
    echo "Content smoke test waiting for $url, attempt $attempt/24"
    sleep 5
  done

  echo "Content smoke test failed for $url after 24 attempts" >&2
  return 1
}

trap 'handle_error "$?"' ERR

require_env LLMHUB_RADAR_IMAGE_OWNER
require_env LLMHUB_RADAR_IMAGE_TAG
validate_image_tag

if [ ! -f .env.radar ]; then
  echo "Missing .env.radar in $(pwd)" >&2
  exit 2
fi

require_env_file_value MARKETPLACE_POSTGRES_PASSWORD
require_env_file_value MARKETPLACE_DATABASE_URL

validate_storefront_source
write_compose_env
validate_compose

if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

echo "Deploying LLMHub Radar image tag: ${LLMHUB_RADAR_IMAGE_TAG}"

"${COMPOSE[@]}" pull dashboard status-page radar-probe-worker db-migrate marketplace-api marketplace-migrate marketplace-maintenance

backup_database
backup_media
backup_marketplace_database

"${COMPOSE[@]}" up -d libsql
wait_for_container_healthy "${LLMHUB_RADAR_LIBSQL_CONTAINER:-llmhub-radar-libsql}"
"${COMPOSE[@]}" up -d marketplace-postgres
wait_for_container_healthy "${LLMHUB_RADAR_MARKETPLACE_POSTGRES_CONTAINER:-llmhub-radar-marketplace-postgres}"
"${COMPOSE[@]}" up \
  --no-deps \
  --force-recreate \
  --abort-on-container-exit \
  --exit-code-from db-migrate \
  db-migrate
"${COMPOSE[@]}" up \
  --no-deps \
  --force-recreate \
  --abort-on-container-exit \
  --exit-code-from marketplace-migrate \
  marketplace-migrate
"${COMPOSE[@]}" up -d --no-build dashboard status-page radar-probe-worker marketplace-api marketplace-maintenance

smoke_test_local
prepare_storefront_release
install_caddy_config
smoke_test_public

CADDY_SWITCHED=0
STOREFRONT_SWITCHED=0
trap - ERR

if [ "${RADAR_DEPLOY_NOTIFICATIONS:-0}" = "1" ]; then
  "${COMPOSE[@]}" run --rm radar-probe-worker bun src/scripts/radar-notification-preflight.ts
  "${COMPOSE[@]}" --profile notifications pull radar-notification-worker
  "${COMPOSE[@]}" --profile notifications up -d --no-build radar-notification-worker
else
  echo "Notification worker was not restarted. Set RADAR_DEPLOY_NOTIFICATIONS=1 after reviewing notification risk."
fi

"${COMPOSE[@]}" ps
