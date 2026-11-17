#!/bin/sh
set -eu

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"

mkdir -p /app/config /app/logs /app/data /app/data/overlays

# Bind mounts are often owned by the host user; fix ownership as root, then
# drop privileges for the actual service.
if [ "$(id -u)" = "0" ]; then
  chown -R "$PUID:$PGID" /app/config /app/logs /app/data 2>/dev/null || true
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
