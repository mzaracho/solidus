#!/bin/sh
# Ejecuta un comando del build con una CA raiz extra opcional (secreto BuildKit "extra_ca").
# Sin el secreto, ejecuta el comando tal cual. Nunca desactiva la verificacion TLS.
set -eu
ca=/run/secrets/extra_ca
if [ -s "$ca" ]; then
  if grep -q 'PRIVATE KEY' "$ca" || ! grep -q 'BEGIN CERTIFICATE' "$ca"; then
    echo 'extra_ca: el archivo no es un certificado PEM publico' >&2
    exit 1
  fi
  bundle=$(mktemp)
  trap 'rm -f "$bundle"' EXIT
  { [ -f /etc/ssl/certs/ca-certificates.crt ] && cat /etc/ssl/certs/ca-certificates.crt; cat "$ca"; } > "$bundle"
  export SSL_CERT_FILE="$bundle" SSL_CA_CERT_FILE="$bundle" NODE_EXTRA_CA_CERTS="$ca" \
         NEXT_TURBOPACK_EXPERIMENTAL_USE_SYSTEM_TLS_CERTS=1
fi
"$@"
