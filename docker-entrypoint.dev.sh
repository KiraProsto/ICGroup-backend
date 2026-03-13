#!/bin/sh
# docker-entrypoint.dev.sh — development container startup script.
#
# Compares the md5 checksum of package.json + package-lock.json against a
# cached value stored inside the node_modules volume. When the checksum
# differs (i.e. dependencies changed), npm ci is re-run automatically, so
# developers never have to remember `docker-compose up --build` just because
# dependencies changed.
set -e

HASH_FILE=/app/node_modules/.package-json-hash
LOCKFILE=/app/package-lock.json

if [ -f "$LOCKFILE" ]; then
  CURRENT_HASH=$(cat /app/package.json "$LOCKFILE" | md5sum | cut -d' ' -f1)
else
  CURRENT_HASH=$(md5sum /app/package.json | cut -d' ' -f1)
fi

if [ ! -f "$HASH_FILE" ] || [ "$(cat "$HASH_FILE")" != "$CURRENT_HASH" ]; then
  echo ">>> package.json or package-lock.json changed — installing npm dependencies..."
  if [ -f "$LOCKFILE" ]; then
    npm ci
  else
    npm install
  fi
  echo "$CURRENT_HASH" > "$HASH_FILE"
  echo ">>> Dependency installation complete."
fi

exec "$@"
