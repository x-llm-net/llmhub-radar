#!/bin/sh
set -eu

cert_dir="/opt/llm-hub/certs"
key_file="$cert_dir/llm-hub.store.key"
csr_file="$cert_dir/llm-hub.store.csr"

test "$(hostname)" = "llm-hub"
test "$(cat /opt/llm-hub/.deployment-id)" = "llm-hub-store-production-v2"
test ! -e "$key_file"
test ! -e "$csr_file"

umask 077
install -d -m 700 "$cert_dir"
# The direct apex domain uses Caddy's public ACME certificate.
openssl req -new -newkey rsa:2048 -nodes \
  -keyout "$key_file" \
  -out "$csr_file" \
  -subj "/CN=*.llm-hub.store" \
  -addext "subjectAltName=DNS:*.llm-hub.store"

chmod 600 "$key_file" "$csr_file"
openssl req -in "$csr_file" -noout -verify >/dev/null
openssl req -in "$csr_file" -noout -subject -text \
  | sed -n '/Subject:/p;/Subject Alternative Name/,+1p'
printf 'ORIGIN_CSR_READY csr=%s key=%s\n' "$csr_file" "$key_file"
