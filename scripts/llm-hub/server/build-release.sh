#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
image_repository="llm-hub/new-api"
release_dir="/opt/llm-hub/releases/$release_tag"
archive="$release_dir/source.tar"
source_dir="$release_dir/source"
image="$image_repository:$release_tag"

printf '%s' "$release_tag" | grep -Eq '^llmhub-[0-9a-f]{7,12}-[0-9]{8}-[0-9]+$'
test -f "$archive"

if docker image inspect "$image" >/dev/null 2>&1; then
  actual_version="$(docker run --rm "$image" --version)"
  test "$actual_version" = "$release_tag"
  docker image inspect "$image" --format 'IMAGE_REUSED={{.RepoTags}} ID={{.Id}} SIZE={{.Size}} CREATED={{.Created}}'
  exit 0
fi

rm -rf "$source_dir"
mkdir -p "$source_dir"
tar -xf "$archive" -C "$source_dir"
printf '%s\n' "$release_tag" > "$source_dir/VERSION"

docker build --pull=false -t "$image" "$source_dir"
actual_version="$(docker run --rm "$image" --version)"
test "$actual_version" = "$release_tag"
docker image inspect "$image" --format 'IMAGE_BUILT={{.RepoTags}} ID={{.Id}} SIZE={{.Size}} CREATED={{.Created}}'
