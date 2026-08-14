#!/bin/sh
set -eu

expected_hostname="ser8272651662"
compose_dir="/opt/llm-hub"
compose_file="$compose_dir/compose.yml"
compose_project="llm-hub"
service="new-api"
container="llm-hub-new-api"
image_repository="llm-hub/new-api"

actual_hostname="$(hostname)"
test "$actual_hostname" = "$expected_hostname"
test -f "$compose_file"

actual_project="$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}')"
actual_service="$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.service"}}')"
actual_working_dir="$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')"
actual_config_file="$(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')"
actual_image="$(docker inspect "$container" --format '{{.Config.Image}}')"

test "$actual_project" = "$compose_project"
test "$actual_service" = "$service"
test "$actual_working_dir" = "$compose_dir"
test "$actual_config_file" = "$compose_file"
case "$actual_image" in
  "$image_repository":*) ;;
  *)
    printf 'unexpected production image: %s\n' "$actual_image" >&2
    exit 1
    ;;
esac

cd "$compose_dir"
docker compose config --quiet
docker compose config --services | grep -qx "$service"
docker compose config --images | grep -Eq "^${image_repository}:"
if docker compose config --images | grep -Eq '(^|/)(x-llm-net)(/|:)|^ghcr\.io/x-llm-net/'; then
  printf 'legacy X-LLM image detected in LLM-Hub compose\n' >&2
  exit 1
fi

health="$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')"
printf 'TARGET_OK deployment=llm-hub-store-production-v1 host=%s compose=%s project=%s service=%s container=%s image=%s health=%s\n' \
  "$actual_hostname" "$compose_file" "$actual_project" "$actual_service" "$container" "$actual_image" "$health"
