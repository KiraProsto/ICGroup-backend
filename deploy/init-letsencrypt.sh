#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Let's Encrypt TLS certificate initialization
#
#  Run AFTER docker-compose.prod.yml is up with HTTP-only nginx:
#    chmod +x init-letsencrypt.sh
#    sudo ./init-letsencrypt.sh
#
#  After success, replace deploy/nginx/conf.d/default.conf
#  with the HTTPS version from default.conf.template.
# ─────────────────────────────────────────────────────────────
set -euo pipefail

# Configuration — CHANGE THESE
DOMAIN="${1:?Usage: $0 <domain> <email>}"
EMAIL="${2:?Usage: $0 <domain> <email>}"
APP_DIR="/opt/icgroup"
COMPOSE="docker compose -f $APP_DIR/docker-compose.prod.yml"

echo "==> Requesting certificate for $DOMAIN..."

# Stop certbot if running
$COMPOSE stop certbot 2>/dev/null || true

# Request certificate
$COMPOSE run --rm certbot certonly \
    --webroot \
    -w /var/www/certbot \
    -d "$DOMAIN" \
    -d "www.$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --force-renewal

echo "==> Certificate obtained!"
echo ""
echo "==> Now enable HTTPS:"
echo "    1. Copy the HTTPS config:"
echo "       sed 's/\${DOMAIN}/$DOMAIN/g' $APP_DIR/deploy/nginx/conf.d/default.conf.template > $APP_DIR/deploy/nginx/conf.d/default.conf"
echo "    2. Reload nginx:"
echo "       $COMPOSE exec nginx nginx -s reload"
echo "    3. Start certbot auto-renewal:"
echo "       $COMPOSE up -d certbot"
echo ""
