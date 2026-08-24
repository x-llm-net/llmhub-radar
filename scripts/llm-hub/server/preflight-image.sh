#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
image="llm-hub/new-api:$release_tag"
container="llm-hub-preflight"
status_file="/tmp/llm-hub-preflight-status.json"

cleanup() {
  docker rm -fv "$container" >/dev/null 2>&1 || true
  rm -f "$status_file"
}
trap cleanup EXIT

cleanup
actual_version="$(docker run --rm "$image" --version)"
test "$actual_version" = "$release_tag"

docker run -d \
  --name "$container" \
  -e TZ=Asia/Shanghai \
  "$image" \
  --log-dir /tmp/logs >/dev/null

attempt=0
while [ "$attempt" -lt 30 ]; do
  if docker exec "$container" wget -q -O "$status_file" http://127.0.0.1:3000/api/status 2>/dev/null; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

docker exec "$container" test -s "$status_file"
docker exec "$container" grep -q '"success":true' "$status_file"
docker exec "$container" grep -q "\"version\":\"$release_tag\"" "$status_file"
printf 'IMAGE_PREFLIGHT_OK image=%s attempts=%s\n' "$image" "$attempt"
docker logs --tail 30 "$container"
