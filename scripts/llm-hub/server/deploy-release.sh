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
sha256sum -c "$backup_dir/mysql.sql.sha256"
docker image inspect "$new_image" >/dev/null
test "$(docker run --rm "$new_image" --version)" = "$release_tag"

old_image="$(sed -n 's/^current_ref=//p' "$backup_dir/release.txt")"
test -n "$old_image"
current_image="$(docker inspect llm-hub-new-api --format '{{.Config.Image}}')"
if [ "$current_image" = "$new_image" ]; then
  test "$(docker inspect llm-hub-new-api --format '{{.State.Health.Status}}')" = "healthy"
  printf 'DEPLOY_ALREADY_COMPLETE image=%s\n' "$new_image"
  exit 0
fi
test "$current_image" = "$old_image"

cd "$compose_dir"
pending_tasks="$(docker exec llm-hub-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM system_tasks WHERE status IN (\"pending\",\"running\") AND type IN (\"channel_test\",\"channel_probe\",\"health_check\");"' | tr -d '[:space:]')"
test "${pending_tasks:-0}" = "0"

current_count="$(grep -c "^[[:space:]]*image: $old_image$" compose.yml)"
test "$current_count" = "1"
sed -i "s#image: $old_image#image: $new_image#" compose.yml
docker compose config --quiet

restore_previous() {
  cp -p "$backup_dir/compose.yml" compose.yml
  docker compose up -d --no-deps --no-build new-api
}

if ! docker compose up -d --no-deps --no-build new-api; then
  restore_previous
  exit 1
fi

healthy="false"
attempt=0
while [ "$attempt" -lt 45 ]; do
  status="$(docker inspect llm-hub-new-api --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    healthy="true"
    break
  fi
  if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ] || [ "$status" = "dead" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$healthy" != "true" ]; then
  docker logs --tail 120 llm-hub-new-api || true
  restore_previous
  exit 1
fi

docker exec llm-hub-new-api wget -q -O /tmp/llm-hub-status.json http://127.0.0.1:3000/api/status
docker exec llm-hub-new-api grep -q '"success":true' /tmp/llm-hub-status.json
docker exec llm-hub-new-api grep -q "\"version\":\"$release_tag\"" /tmp/llm-hub-status.json
docker inspect llm-hub-new-api --format 'DEPLOY_OK image={{.Config.Image}} id={{.Image}} health={{.State.Health.Status}} status={{.State.Status}}'
