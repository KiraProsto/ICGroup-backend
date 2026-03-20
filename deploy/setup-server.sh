#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Server bootstrap script for ICGroup Backend
#
#  Run on a fresh Ubuntu 22.04/24.04 VPS as root:
#    curl -sSL https://raw.githubusercontent.com/<repo>/main/deploy/setup-server.sh | bash
#  or copy to server and run:
#    chmod +x setup-server.sh && sudo ./setup-server.sh
#
#  What it does:
#    1. Updates OS packages
#    2. Installs Docker Engine + Docker Compose
#    3. Creates deploy user with docker access
#    4. Creates /opt/icgroup directory structure
#    5. Configures UFW firewall
#    6. Sets up automatic security updates
#    7. Adds cron for certbot renewal and Docker prune
# ─────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/icgroup"
DEPLOY_USER="deploy"

echo "==> [1/7] Updating system packages..."
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git ufw fail2ban unattended-upgrades apt-transport-https ca-certificates gnupg lsb-release

echo "==> [2/7] Installing Docker Engine..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "     Docker already installed: $(docker --version)"
fi

echo "==> [3/7] Creating deploy user..."
if ! id "$DEPLOY_USER" &>/dev/null; then
    useradd -m -s /bin/bash -G docker "$DEPLOY_USER"
    mkdir -p /home/$DEPLOY_USER/.ssh
    chmod 700 /home/$DEPLOY_USER/.ssh

    echo ""
    echo "  ╔══════════════════════════════════════════════════╗"
    echo "  ║  ACTION REQUIRED: Add your SSH public key to:   ║"
    echo "  ║  /home/$DEPLOY_USER/.ssh/authorized_keys             ║"
    echo "  ╚══════════════════════════════════════════════════╝"
    echo ""
else
    echo "     User '$DEPLOY_USER' already exists"
    usermod -aG docker "$DEPLOY_USER" 2>/dev/null || true
fi

echo "==> [4/7] Creating application directory..."
mkdir -p "$APP_DIR/deploy/nginx/conf.d"
chown -R $DEPLOY_USER:$DEPLOY_USER "$APP_DIR"

echo "==> [5/7] Configuring firewall (UFW)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'SSH'
ufw allow 80/tcp    comment 'HTTP'
ufw allow 443/tcp   comment 'HTTPS'
ufw allow 9443/tcp  comment 'Portainer UI'
ufw allow 3001/tcp  comment 'Uptime Kuma status dashboard'
echo "y" | ufw enable
ufw status verbose

echo "==> [6/7] Configuring fail2ban..."
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s
maxretry = 3
EOF
systemctl enable fail2ban
systemctl restart fail2ban

echo "==> [7/7] Setting up cron jobs..."
# Certbot renewal check (twice daily)
cat > /etc/cron.d/icgroup-certbot << EOF
0 */12 * * * root docker compose -f $APP_DIR/docker-compose.prod.yml exec -T certbot certbot renew --quiet && docker compose -f $APP_DIR/docker-compose.prod.yml exec -T nginx nginx -s reload 2>/dev/null || true
EOF

# Docker cleanup (weekly)
cat > /etc/cron.d/icgroup-docker-prune << EOF
0 3 * * 0 root docker system prune -af --volumes --filter "until=168h" 2>/dev/null || true
EOF

# Automatic security updates
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

echo ""
echo "  ┌──────────────────────────────────────────────────────┐"
echo "  │           Server setup complete!                     │"
echo "  ├──────────────────────────────────────────────────────┤"
echo "  │  Next steps:                                         │"
echo "  │                                                      │"
echo "  │  1. Add SSH key to /home/$DEPLOY_USER/.ssh/authorized_keys │"
echo "  │  2. Copy deploy files to $APP_DIR/:              │"
echo "  │     - docker-compose.prod.yml                        │"
echo "  │     - deploy/nginx/nginx.conf                        │"
echo "  │     - deploy/nginx/conf.d/default.conf               │"
echo "  │     - .env.production                                │"
echo "  │  3. Run: docker compose -f docker-compose.prod.yml   │"
echo "  │          --env-file .env.production up -d             │"
echo "  │  4. Open https://<server-ip>:9443 for Portainer      │"
echo "  │  5. Set up TLS with init-letsencrypt.sh              │"
echo "  │                                                      │"
echo "  │  Firewall: 22 (SSH), 80 (HTTP), 443 (HTTPS),        │"
echo "  │            9443 (Portainer), 3001 (Uptime Kuma)      │"
echo "  └──────────────────────────────────────────────────────┘"
echo ""
