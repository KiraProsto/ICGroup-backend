#!/bin/sh
# docker-entrypoint.dev.sh — development container startup script.
#
# Compares the md5 checksum of package.json against a cached value stored
# inside the node_modules volume.  When the checksum differs (i.e. a
# dependency was added or removed), npm install is re-run automatically,
# so developers never have to remember `docker-compose up --build` just
# because package.json changed.
set -e

HASH_FILE=/app/node_modules/.package-json-hash
CURRENT_HASH=$(md5sum /app/package.json | cut -d' ' -f1)

if [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$CURRENT_HASH" ]; then
  echo ">>> package.json changed — running npm install..."
  npm install
  echo "$CURRENT_HASH" > "$HASH_FILE"
  echo ">>> npm install complete."
fi

exec "$@"
