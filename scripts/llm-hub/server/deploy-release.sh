#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
compose_dir="/opt/llm-hub"
backup_dir="$compose_dir/backups/pre-$release_tag"
new_image="llm-hub/new-api:$release_tag"

"$script_dir/assert-target.sh"
test -f "$backup_dir/release.txt"
test -f "$backup_dir/compose.yml"
test -f "$backup_dir/.env"
sha256sum -c "$backup_dir/mysql.sql.sha256"
docker image inspect "$new_image" >/dev/null
test "$(docker run --rm "$new_image" --version)" = "$release_tag"

old_image="$(sed -n 's/^current_ref=//p' "$backup_dir/release.txt")"
case "$old_image" in
  llm-hub/new-api:*) old_tag="${old_image#llm-hub/new-api:}" ;;
  *) printf 'unexpected previous image: %s\n' "$old_image" >&2; exit 1 ;;
esac
current_image="$(docker inspect llm-hub-new-api --format '{{.Config.Image}}')"
if [ "$current_image" = "$new_image" ]; then
  test "$(sed -n 's/^LLMHUB_IMAGE_TAG=//p' "$compose_dir/.env")" = "$release_tag"
  test "$(docker inspect llm-hub-new-api --format '{{.State.Health.Status}}')" = "healthy"
  printf 'DEPLOY_ALREADY_COMPLETE image=%s\n' "$new_image"
  exit 0
fi
test "$current_image" = "$old_image"

cd "$compose_dir"
if ! pending_tasks="$(docker exec llm-hub-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT COUNT(*) FROM system_tasks WHERE status IN (\"pending\",\"running\") AND type IN (\"channel_test\",\"hub_supply_probe\");"')"; then
  printf 'unable to query active release-blocking tasks\n' >&2
  exit 1
fi
case "$pending_tasks" in
  ''|*[!0-9]*) printf 'invalid active task count: %s\n' "$pending_tasks" >&2; exit 1 ;;
esac
test "$pending_tasks" = "0"

current_count="$(grep -c "^LLMHUB_IMAGE_TAG=$old_tag$" .env)"
test "$current_count" = "1"

restore_previous() {
  cp -p "$backup_dir/.env" .env || return 1
  cp -p "$backup_dir/compose.yml" compose.yml || return 1
  docker compose up -d --no-deps --no-build new-api || return 1
  wait_for_healthy "$old_image" || return 1
  docker exec llm-hub-new-api wget -q -O /tmp/llm-hub-status.json http://127.0.0.1:3000/api/status || return 1
  docker exec llm-hub-new-api grep -q '"success":true' /tmp/llm-hub-status.json || return 1
  printf 'DEPLOY_RESTORED_PREVIOUS image=%s\n' "$old_image"
}

wait_for_healthy() {
  expected_image="$1"
  attempt=0
  while [ "$attempt" -lt 45 ]; do
    status="$(docker inspect llm-hub-new-api --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
    actual_image="$(docker inspect llm-hub-new-api --format '{{.Config.Image}}' 2>/dev/null || true)"
    if [ "$status" = "healthy" ] && [ "$actual_image" = "$expected_image" ]; then
      return 0
    fi
    if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
      return 1
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  return 1
}

deploy_new() {
  sed -i "s#^LLMHUB_IMAGE_TAG=$old_tag$#LLMHUB_IMAGE_TAG=$release_tag#" .env &&
    docker compose config --quiet &&
    docker compose up -d --no-deps --no-build new-api &&
    wait_for_healthy "$new_image" &&
    docker exec llm-hub-new-api wget -q -O /tmp/llm-hub-status.json http://127.0.0.1:3000/api/status &&
    docker exec llm-hub-new-api grep -q '"success":true' /tmp/llm-hub-status.json &&
    docker exec llm-hub-new-api grep -q "\"version\":\"$release_tag\"" /tmp/llm-hub-status.json &&
    test "$(sed -n 's/^LLMHUB_IMAGE_TAG=//p' .env)" = "$release_tag"
}

if ! deploy_new; then
  docker logs --tail 120 llm-hub-new-api 2>/dev/null || true
  if ! restore_previous; then
    printf 'automatic restoration failed after deployment or verification error\n' >&2
  fi
  exit 1
fi

docker inspect llm-hub-new-api --format 'DEPLOY_OK image={{.Config.Image}} id={{.Image}} health={{.State.Health.Status}} status={{.State.Status}}'
