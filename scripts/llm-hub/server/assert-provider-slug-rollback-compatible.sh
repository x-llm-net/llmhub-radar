#!/bin/sh
set -eu

target_image="${1:?target image is required}"

docker image inspect "$target_image" >/dev/null
scope="$(docker image inspect "$target_image" --format '{{index .Config.Labels "com.llmhub.provider-slug-scope"}}' 2>/dev/null || true)"
target_version="$(docker run --rm "$target_image" --version)"

if [ "$scope" = "tenant" ]; then
  printf 'ROLLBACK_COMPATIBLE image=%s version=%s provider_slug_scope=tenant\n' "$target_image" "$target_version"
  exit 0
fi

# d0177ca is the first deployed tenant-scoped image and predates the label.
case "$target_version" in
  llmhub-d0177ca-*)
    printf 'ROLLBACK_COMPATIBLE image=%s version=%s provider_slug_scope=tenant-baseline\n' "$target_image" "$target_version"
    exit 0
    ;;
esac

if ! duplicate_count="$(docker exec llm-hub-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" --batch --skip-column-names -e "SELECT COUNT(*) FROM (SELECT slug FROM hub_providers GROUP BY slug HAVING COUNT(*) > 1) AS duplicate_slugs;"')"; then
  printf 'ROLLBACK_BLOCKED unable to verify provider slug compatibility; target image %s was not started.\n' "$target_image" >&2
  exit 1
fi
case "$duplicate_count" in
  ''|*[!0-9]*)
    printf 'ROLLBACK_BLOCKED invalid duplicate provider slug count %s; target image %s was not started.\n' "$duplicate_count" "$target_image" >&2
    exit 1
    ;;
esac
if [ "$duplicate_count" -gt 0 ]; then
  printf 'ROLLBACK_BLOCKED provider_slug_schema_incompatible target_image=%s duplicate_slugs=%s\n' "$target_image" "$duplicate_count" >&2
  printf 'Starting this image without its matching database backup may rewrite provider public URLs. No rollback was started.\n' >&2
  exit 1
fi

printf 'ROLLBACK_COMPATIBLE image=%s version=%s duplicate_slugs=0\n' "$target_image" "$target_version"
