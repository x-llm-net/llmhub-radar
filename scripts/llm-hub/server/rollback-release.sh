#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
compose_dir="/opt/llm-hub"
backup_dir="$compose_dir/backups/pre-$release_tag"
deployed_image="llm-hub/new-api:$release_tag"

"$script_dir/assert-target.sh"
test -f "$backup_dir/release.txt"
test -f "$backup_dir/compose.yml"
test -f "$backup_dir/.env"
sha256sum -c "$backup_dir/mysql.sql.sha256"

old_image="$(sed -n 's/^current_ref=//p' "$backup_dir/release.txt")"
case "$old_image" in
  llm-hub/new-api:*) old_tag="${old_image#llm-hub/new-api:}" ;;
  *) printf 'unexpected previous image: %s\n' "$old_image" >&2; exit 1 ;;
esac
docker image inspect "$old_image" >/dev/null

current_image="$(docker inspect llm-hub-new-api --format '{{.Config.Image}}')"
if [ "$current_image" = "$old_image" ]; then
  test "$(sed -n 's/^LLMHUB_IMAGE_TAG=//p' "$compose_dir/.env")" = "$old_tag"
  test "$(docker inspect llm-hub-new-api --format '{{.State.Health.Status}}')" = "healthy"
  printf 'ROLLBACK_ALREADY_COMPLETE image=%s\n' "$old_image"
  exit 0
fi
test "$current_image" = "$deployed_image"
"$script_dir/assert-provider-slug-rollback-compatible.sh" "$old_image"

cd "$compose_dir"
cp -p "$backup_dir/.env" .env
cp -p "$backup_dir/compose.yml" compose.yml
docker compose config --quiet
docker compose up -d --no-deps --no-build new-api

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
test "$healthy" = "true"
test "$(docker inspect llm-hub-new-api --format '{{.Config.Image}}')" = "$old_image"
test "$(sed -n 's/^LLMHUB_IMAGE_TAG=//p' .env)" = "$old_tag"
docker inspect llm-hub-new-api --format 'ROLLBACK_OK image={{.Config.Image}} id={{.Image}} health={{.State.Health.Status}} status={{.State.Status}}'
