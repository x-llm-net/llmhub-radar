#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
network="llm-hub-preflight-mysql"
mysql_container="llm-hub-mysql-preflight"
app_container="llm-hub-app-preflight"
mysql_password="llmhub-preflight-only"
dump_file="/tmp/llm-hub-preflight-$release_tag.sql"
image="llm-hub/new-api:$release_tag"

cleanup() {
  docker rm -f "$app_container" "$mysql_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -f "$dump_file"
}
trap cleanup EXIT

"$script_dir/assert-target.sh"
cleanup
docker exec llm-hub-mysql sh -c 'exec mysqldump --no-tablespaces --single-transaction --routines --triggers -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" --databases "$MYSQL_DATABASE"' > "$dump_file"
test -s "$dump_file"

docker network create "$network" >/dev/null
docker run -d \
  --name "$mysql_container" \
  --network "$network" \
  -e MYSQL_ROOT_PASSWORD="$mysql_password" \
  -e TZ=Asia/Shanghai \
  mysql:8.4 \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci >/dev/null

attempt=0
while [ "$attempt" -lt 60 ]; do
  if docker exec "$mysql_container" mysqladmin ping -h 127.0.0.1 -uroot -p"$mysql_password" --silent 2>/dev/null; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
test "$attempt" -lt 60
docker exec -i "$mysql_container" mysql -uroot -p"$mysql_password" < "$dump_file"

docker run -d \
  --name "$app_container" \
  --network "$network" \
  -e 'SQL_DSN=root:llmhub-preflight-only@tcp(llm-hub-mysql-preflight:3306)/new-api?charset=utf8mb4&parseTime=True&loc=Local' \
  -e SESSION_SECRET=llmhub-preflight-session-secret \
  -e TZ=Asia/Shanghai \
  "$image" \
  --log-dir /tmp/logs >/dev/null

attempt=0
while [ "$attempt" -lt 60 ]; do
  if docker exec "$app_container" wget -q -O /tmp/status.json http://127.0.0.1:3000/api/status 2>/dev/null; then
    break
  fi
  if [ "$(docker inspect "$app_container" --format '{{.State.Status}}')" = "exited" ]; then
    docker logs "$app_container"
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep 1
done

docker exec "$app_container" grep -q '"success":true' /tmp/status.json
docker exec "$app_container" grep -q "\"version\":\"$release_tag\"" /tmp/status.json
printf 'MYSQL_PREFLIGHT_OK image=%s attempts=%s\n' "$image" "$attempt"
docker logs --tail 50 "$app_container"
