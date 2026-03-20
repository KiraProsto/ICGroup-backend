#!/bin/sh
# docker-entrypoint.sh — runs Prisma migrations then hands off to CMD.
# Called by the production Docker image before starting the Node process.
set -e

echo "Running Prisma migrations..."
./node_modules/.bin/prisma migrate deploy
echo "Migrations complete."

exec "$@"
