#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
script_dir="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
expected_image="llm-hub/new-api:$release_tag"

"$script_dir/assert-target.sh"
test "$(docker inspect llm-hub-new-api --format '{{.Config.Image}}')" = "$expected_image"
test "$(docker inspect llm-hub-new-api --format '{{.State.Status}}')" = "running"
test "$(docker inspect llm-hub-new-api --format '{{.State.Health.Status}}')" = "healthy"
test "$(docker exec llm-hub-new-api /new-api --version)" = "$release_tag"
docker exec llm-hub-new-api wget -q -O /tmp/llm-hub-status.json http://127.0.0.1:3000/api/status
docker exec llm-hub-new-api grep -q '"success":true' /tmp/llm-hub-status.json
docker exec llm-hub-new-api grep -q "\"version\":\"$release_tag\"" /tmp/llm-hub-status.json
docker exec llm-hub-new-api grep -q '"server_address":"https://llm-hub.store"' /tmp/llm-hub-status.json
docker inspect llm-hub-new-api --format 'VERIFY_REMOTE_OK image={{.Config.Image}} id={{.Image}} health={{.State.Health.Status}} status={{.State.Status}}'
