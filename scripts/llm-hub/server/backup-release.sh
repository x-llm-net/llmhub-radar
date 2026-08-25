#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
compose_dir="/opt/llm-hub"
backup_dir="$compose_dir/backups/pre-$release_tag"
rollback_tag="llm-hub/new-api:rollback-before-$release_tag"

umask 077

"$script_dir/assert-target.sh"
printf '%s' "$release_tag" | grep -Eq '^llmhub-[0-9a-f]{7,12}-[0-9]{8}-[0-9]+$'
test ! -e "$backup_dir"
test "$(docker inspect llm-hub-new-api --format '{{.State.Status}}')" = "running"
test "$(docker inspect llm-hub-new-api --format '{{.State.Health.Status}}')" = "healthy"

cd "$compose_dir"
if ! pending_tasks="$(docker exec llm-hub-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT COUNT(*) FROM system_tasks WHERE status IN (\"pending\",\"running\") AND type IN (\"channel_test\",\"hub_supply_probe\");"')"; then
  printf 'unable to query active release-blocking tasks\n' >&2
  exit 1
fi
case "$pending_tasks" in
  ''|*[!0-9]*) printf 'invalid active task count: %s\n' "$pending_tasks" >&2; exit 1 ;;
esac
test "$pending_tasks" = "0"

install -d -m 700 "$backup_dir"
cp -p .env "$backup_dir/.env"
cp -p compose.yml "$backup_dir/compose.yml"

current_ref="$(docker inspect llm-hub-new-api --format '{{.Config.Image}}')"
current_id="$(docker inspect llm-hub-new-api --format '{{.Image}}')"
printf 'release_tag=%s\ncurrent_ref=%s\ncurrent_id=%s\nrollback_tag=%s\n' \
  "$release_tag" "$current_ref" "$current_id" "$rollback_tag" > "$backup_dir/release.txt"

docker image tag "$current_id" "$rollback_tag"
docker exec llm-hub-mysql sh -c 'exec mysqldump --no-tablespaces --single-transaction --quick --routines --triggers --events --hex-blob -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --databases "$MYSQL_DATABASE"' > "$backup_dir/mysql.sql"
test -s "$backup_dir/mysql.sql"
sha256sum "$backup_dir/mysql.sql" > "$backup_dir/mysql.sql.sha256"
sha256sum -c "$backup_dir/mysql.sql.sha256"

printf 'BACKUP_OK dir=%s size=%s rollback=%s current=%s\n' \
  "$backup_dir" "$(du -h "$backup_dir/mysql.sql" | cut -f1)" "$rollback_tag" "$current_ref"
