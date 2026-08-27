#!/bin/sh
set -eu

release_tag="${1:?release tag is required}"
release_dir="/opt/llm-hub/releases/$release_tag"
tools_dir="$release_dir/tools"
source_tools_dir="$release_dir/source/scripts/llm-hub/server"
rollback_guard="assert-provider-slug-rollback-compatible.sh"

test -f "$release_dir/source.tar"
test -f "$release_dir/source.tar.sha256"
cd "$release_dir"
sha256sum -c source.tar.sha256
test -f "$tools_dir/$rollback_guard"
test -f "$source_tools_dir/$rollback_guard"

for tool in "$tools_dir"/*.sh; do
  name="$(basename "$tool")"
  test -f "$source_tools_dir/$name"
  cmp "$tool" "$source_tools_dir/$name"
done

printf 'RELEASE_TOOLS_OK release=%s\n' "$release_tag"
