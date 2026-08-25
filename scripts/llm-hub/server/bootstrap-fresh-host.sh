#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
compose_source="${2:?compose source is required}"
caddy_source="${3:?Caddyfile source is required}"
compose_dir="/opt/llm-hub"
deployment_id="llm-hub-store-production-v2"

printf '%s' "$release_tag" | grep -Eq '^llmhub-[0-9a-f]{7,12}-[0-9]{8}-[0-9]+$'
test "$(hostname)" = "llm-hub"
test -f "$compose_source"
test -f "$caddy_source"
test ! -e "$compose_dir/.env"
test -d /opt/backups/x-llm-net/pre-llmhub-colocation-20260825-120115
! docker volume inspect llm-hub_mysql_data >/dev/null 2>&1
! docker volume inspect llm-hub_redis_data >/dev/null 2>&1

umask 077
install -d -m 700 \
  "$compose_dir" \
  "$compose_dir/backups" \
  "$compose_dir/certs" \
  "$compose_dir/data" \
  "$compose_dir/logs/app" \
  "$compose_dir/logs/caddy" \
  "$compose_dir/releases"

install -m 600 "$compose_source" "$compose_dir/compose.yml"
install -m 600 "$caddy_source" "$compose_dir/Caddyfile"
printf '%s\n' "$deployment_id" > "$compose_dir/.deployment-id"

mysql_root_password="$(openssl rand -hex 32)"
mysql_password="$(openssl rand -hex 32)"
redis_password="$(openssl rand -hex 32)"
session_secret="$(openssl rand -hex 48)"

cat > "$compose_dir/.env" <<EOF
LLMHUB_IMAGE_TAG=$release_tag
MYSQL_ROOT_PASSWORD=$mysql_root_password
MYSQL_DATABASE=llm_hub
MYSQL_USER=llm_hub
MYSQL_PASSWORD=$mysql_password
REDIS_PASSWORD=$redis_password
SESSION_SECRET=$session_secret
SESSION_COOKIE_TRUSTED_URL=https://llm-hub.store,https://app.llm-hub.store,https://343246113.xyz
TZ=Asia/Shanghai
EOF
chmod 600 "$compose_dir/.env" "$compose_dir/.deployment-id" "$compose_dir/compose.yml" "$compose_dir/Caddyfile"

cd "$compose_dir"
docker compose config --quiet

printf 'FRESH_HOST_BOOTSTRAPPED host=%s deployment=%s compose=%s release=%s\n' \
  "$(hostname)" "$deployment_id" "$compose_dir/compose.yml" "$release_tag"
