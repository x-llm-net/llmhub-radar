#!/bin/sh
set -eu

compose_dir="/opt/llm-hub"

test "$(hostname)" = "llm-hub"
test "$(cat "$compose_dir/.deployment-id")" = "llm-hub-store-production-v2"

cd "$compose_dir"
for container in llm-hub-mysql llm-hub-redis llm-hub-new-api llm-hub-caddy; do
  test "$(docker inspect "$container" --format '{{.State.Health.Status}}')" = "healthy"
done

table_count="$(docker compose exec -T mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();"' \
  | tr -d '[:space:]')"
user_count="$(docker compose exec -T mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM users;"' \
  | tr -d '[:space:]')"
channel_count="$(docker compose exec -T mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM channels;"' \
  | tr -d '[:space:]')"
provider_count="$(docker compose exec -T mysql sh -c \
  'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -N -e "SELECT COUNT(*) FROM hub_providers;"' \
  | tr -d '[:space:]')"

test "$table_count" -gt 0
test "$user_count" = "0"
test "$channel_count" = "0"
test "$provider_count" = "0"

printf 'FRESH_DATABASE_OK containers=healthy tables=%s users=%s channels=%s providers=%s\n' \
  "$table_count" "$user_count" "$channel_count" "$provider_count"
