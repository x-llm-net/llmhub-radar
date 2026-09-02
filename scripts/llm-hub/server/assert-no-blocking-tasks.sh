#!/bin/sh
set -eu

pending_tasks="$(docker exec llm-hub-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT COUNT(*) FROM system_tasks WHERE status IN (\"pending\",\"running\") AND type IN (\"channel_test\",\"hub_supply_probe\");"')"
case "$pending_tasks" in
  ''|*[!0-9]*) printf 'INVALID_BLOCKING_TASK_COUNT value=%s\n' "$pending_tasks" >&2; exit 1 ;;
esac
if [ "$pending_tasks" != "0" ]; then
  printf 'BLOCKING_TASKS count=%s\n' "$pending_tasks"
  exit 2
fi
printf 'NO_BLOCKING_TASKS count=0\n'
