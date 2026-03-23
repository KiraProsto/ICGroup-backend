# Deployment Guide — ICGroup Backend

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VPS (Timeweb Cloud / Yandex Cloud)                     │
│                                                         │
│  ┌─────────┐    ┌──────┐    ┌───────────────────────┐   │
│  │ Nginx   │───▶│ App  │───▶│ PostgreSQL 16         │   │
│  │ :80/443 │    │ :3000│    │ Redis 7               │   │
│  └─────────┘    └──────┘    │ MinIO (S3)            │   │
│                             └───────────────────────┘   │
│  ┌──────────────────┐  ┌──────────────────────────┐     │
│  │ Portainer CE     │  │ Uptime Kuma              │     │
│  │ :9443 (DevOps)   │  │ :3001 (Team dashboard)   │     │
│  └──────────────────┘  └──────────────────────────┘     │
│  ┌──────────┐                                           │
│  │ Certbot  │  (auto TLS renewal)                       │
│  └──────────┘                                           │
└─────────────────────────────────────────────────────────┘
```

## CI/CD Pipeline

```
push to main ──▶ Lint ──▶ Tests ──▶ E2E ──▶ Docker Build ──▶ Deploy
                  │        │        │         │ (GHCR)       │ (SSH)
                  ▼        ▼        ▼         ▼              ▼
               ESLint    Jest    Jest E2E   Push image    Pull + Up
               Prettier  Coverage           latest tag   Health check
               TypeCheck
```

### GitHub Actions Jobs 

| Job | Trigger | What it does |
|---|---|---|
| **lint** | push/PR to main,dev | ESLint, Prettier, TypeCheck |
| **test** | push/PR to main,dev | Unit tests + coverage report |
| **e2e** | after lint | E2E tests |
| **docker** | after all tests | Build production image, push to GHCR |
| **deploy** | push to main only | SSH to VPS, pull image, restart, health check |

## Prerequisites

- VPS with Ubuntu 22.04+ (2 vCPU, 4 GB RAM, 40 GB SSD minimum)
- Domain name pointing to VPS IP (A record) — optional for initial setup
- GitHub repository with Actions enabled


## Initial Server Setup

### 1. Bootstrap the server

SSH into the VPS as root and run:

```bash
# Upload and run the bootstrap script
scp deploy/setup-server.sh root@YOUR_SERVER_IP:/tmp/
ssh root@YOUR_SERVER_IP 'chmod +x /tmp/setup-server.sh && /tmp/setup-server.sh'
```

This installs Docker, creates a `deploy` user, configures UFW firewall, and sets up fail2ban.

### 2. Configure SSH key access

```bash
# Copy your SSH public key for the deploy user
# Linux / macOS:
ssh root@YOUR_SERVER_IP 'cat >> /home/deploy/.ssh/authorized_keys' < ~/.ssh/id_rsa.pub
ssh root@YOUR_SERVER_IP 'chown -R deploy:deploy /home/deploy/.ssh'
```

```powershell
# PowerShell (Windows):
Get-Content ~/.ssh/id_rsa.pub | ssh root@YOUR_SERVER_IP 'cat >> /home/deploy/.ssh/authorized_keys'
ssh root@YOUR_SERVER_IP 'chown -R deploy:deploy /home/deploy/.ssh'
```

> Use whichever key type you have (`id_rsa.pub`, `id_ed25519.pub`, etc.).

### 3. Copy deployment files

```bash
# From your local machine
scp docker-compose.prod.yml deploy@YOUR_SERVER_IP:/opt/icgroup/
scp -r deploy/nginx deploy@YOUR_SERVER_IP:/opt/icgroup/deploy/
```

### 4. Create production environment file

```bash
ssh deploy@YOUR_SERVER_IP
cd /opt/icgroup

# Create .env.production from the template
cat > .env.production << 'EOF'
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
CORS_ORIGINS=https://your-domain.com
SHUTDOWN_TIMEOUT_MS=10000
TRUST_PROXY=true

# PostgreSQL
POSTGRES_DB=icgroup
POSTGRES_USER=icgroup
POSTGRES_PASSWORD=<GENERATE_STRONG_PASSWORD>
DATABASE_URL=postgresql://icgroup:<SAME_PASSWORD>@postgres:5432/icgroup

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<GENERATE_STRONG_PASSWORD_16+_CHARS>

# JWT (generate: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_ACCESS_SECRET=<GENERATE_64_HEX_CHARS>
JWT_REFRESH_SECRET=<GENERATE_64_HEX_CHARS>
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# MinIO
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=<GENERATE_ACCESS_KEY>
MINIO_SECRET_KEY=<GENERATE_STRONG_PASSWORD_16+_CHARS>
MINIO_BUCKET_CONTENT=content-images

# Docker image
APP_IMAGE=ghcr.io/<owner>/icgroup-backend:latest

# Rate limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=120
THROTTLE_LOGIN_TTL=60
THROTTLE_LOGIN_LIMIT=5

# DB pool
DB_POOL_MAX=20
DB_POOL_CONNECT_TIMEOUT_MS=3000
DB_POOL_IDLE_TIMEOUT_MS=10000
DB_STATEMENT_TIMEOUT_MS=30000
EOF
```

Generate strong passwords:
```bash
# PostgreSQL / MinIO / Redis passwords
openssl rand -base64 24

# JWT secrets (64 hex chars)
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 5. Build the Docker image

If deploying via CI/CD (GHCR), skip this step — the image is pulled automatically.
For manual / first-time deployment, build the image on the server:

```bash
# Upload source code from your local machine
cd /path/to/project
tar czf /tmp/icgroup-src.tar.gz \
  --exclude=node_modules --exclude=.git --exclude=dist \
  --exclude=coverage --exclude=.env* --exclude=.venv .

scp /tmp/icgroup-src.tar.gz deploy@YOUR_SERVER_IP:/opt/icgroup/

# On the server: extract and build
ssh deploy@YOUR_SERVER_IP
cd /opt/icgroup
mkdir -p src && tar xzf icgroup-src.tar.gz
docker build --target production -t icgroup-backend:latest .
rm icgroup-src.tar.gz
```

Then set `APP_IMAGE=icgroup-backend:latest` in `.env.production` (local image, no registry pull).

### 6. Start all services

```bash
cd /opt/icgroup

# Start all services
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# Check status
docker compose -f docker-compose.prod.yml ps

# Check logs
docker compose -f docker-compose.prod.yml logs -f app
```

The app entrypoint automatically runs `prisma migrate deploy` before starting.

### 7. Seed initial admin user

```bash
docker compose -f docker-compose.prod.yml exec app \
  node -r dotenv/config --import=tsx/esm prisma/seed.ts
```

Or set the env vars explicitly:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e SEED_ADMIN_EMAIL=admin@example.com \
  -e SEED_ADMIN_PASSWORD='<strong-password>' \
  app node --import=tsx/esm prisma/seed.ts
```

The seed is idempotent — safe to run multiple times.

### 8. Set up TLS (Let's Encrypt)

```bash
chmod +x deploy/init-letsencrypt.sh
sudo ./deploy/init-letsencrypt.sh your-domain.com admin@your-domain.com

# Enable HTTPS config
sed 's/${DOMAIN}/your-domain.com/g' \
  deploy/nginx/conf.d/default.conf.template > deploy/nginx/conf.d/default.conf

# Reload nginx
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload

# Start auto-renewal
docker compose -f docker-compose.prod.yml up -d certbot
```

### 9. Access Portainer UI (DevOps / Developers)

Open `https://YOUR_SERVER_IP:9443` in your browser.

> **IMPORTANT:** You must set the admin password **within ~5 minutes** of
> Portainer starting. If it times out, restart the container:
> ```bash
> docker compose -f docker-compose.prod.yml restart portainer
> ```
> Then immediately open the UI and create your admin account.

Portainer provides:
- Container monitoring (logs, stats, restart)
- Image management (pull, remove)
- Volume and network inspection
- Stack deployment
- Real-time container console access

### 10. Set up Uptime Kuma (Team Status Dashboard)

Open `http://YOUR_SERVER_IP:3001` in your browser.

On first visit, create an admin account. Then:

1. **Add monitors:**
   - HTTP monitor → `http://app:3000/health` (internal health check)
   - HTTP monitor → `https://your-domain.com/health` (external health check)
   - TCP monitor → `postgres:5432` (database)
   - TCP monitor → `redis:6379` (cache)

2. **Create a public status page:**
   - Go to "Status Pages" → "New Status Page"
   - Add your monitors to the page
   - Share the URL with the whole team: `http://YOUR_SERVER_IP:3001/status/icgroup`

3. **Set up notifications:**
   - Telegram bot → notify the team chat on downtime
   - Email → notify managers when services go down

This is the **primary UI for non-technical team members** — content managers, sales, and stakeholders can check service health at a glance without any DevOps knowledge.

## GitHub Secrets Configuration

Add these secrets in GitHub → Settings → Secrets and variables → Actions:

| Secret | Description | Example |
|---|---|---|
| `DEPLOY_HOST` | VPS IP address | `185.x.x.x` |
| `DEPLOY_USER` | SSH username | `deploy` |
| `DEPLOY_SSH_KEY` | Private SSH key (ed25519) | `-----BEGIN OPENSSH...` |
| `DEPLOY_SSH_PORT` | SSH port (optional) | `22` |
| `GHCR_TOKEN` | GitHub PAT with `read:packages` | `ghp_xxx...` |

Add this variable in GitHub → Settings → Environments → production → Variables:

| Variable | Description | Example |
|---|---|---|
| `DEPLOY_DOMAIN` | Production domain | `api.icgroup.com` |

## Routine Operations

### View logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f app --tail=100
```

### Manual deployment
```bash
cd /opt/icgroup
docker compose -f docker-compose.prod.yml pull app
docker compose -f docker-compose.prod.yml up -d app
```

### Database backup
```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U icgroup icgroup | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

### Database restore
```bash
gunzip -c backup_20260320_120000.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U icgroup icgroup
```

### Rollback
```bash
# Deploy a specific version
APP_IMAGE=ghcr.io/<owner>/icgroup-backend:sha-abc1234 \
  docker compose -f docker-compose.prod.yml up -d app
```

### View resource usage
```bash
docker stats --no-stream
```

## Monitoring & Team Dashboards

| Dashboard | URL | Audience | Purpose |
|---|---|---|---|
| **Uptime Kuma** | `http://<server-ip>:3001` | **Everyone** (managers, editors, sales) | Service health, uptime history, alerts |
| **Status Page** | `http://<server-ip>:3001/status/icgroup` | **Everyone** (shareable link) | Public-facing uptime status |
| **Portainer** | `https://<server-ip>:9443` | DevOps / Developers | Container management, logs, restart |
| **GitHub Actions** | GitHub repo → Actions tab | Developers | CI/CD pipeline runs, build status |
| **Swagger** | `https://<domain>/api/v1` | Developers | API documentation (OpenAPI) |
| **Health endpoint** | `https://<domain>/health` | Automated checks | Machine-readable health status |

## File Structure

```
/opt/icgroup/                    # Server app directory
├── docker-compose.prod.yml      # Production compose
├── .env.production              # Secrets (gitignored)
└── deploy/
    ├── nginx/
    │   ├── nginx.conf           # Main nginx config
    │   └── conf.d/
    │       └── default.conf     # Site config (HTTP or HTTPS)
    ├── setup-server.sh          # Initial server bootstrap
    └── init-letsencrypt.sh      # TLS cert initialization
```

## Troubleshooting

### Portainer shows "timed out for security purposes"

Portainer locks itself if the admin password isn't set within ~5 minutes of first start.
Restart it and immediately visit the UI:

```bash
docker compose -f docker-compose.prod.yml restart portainer
# Then open https://<server-ip>:9443 right away
```

### Redis eviction policy warning

BullMQ requires `maxmemory-policy noeviction`. If the app logs show:
```
IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"
```

The `docker-compose.prod.yml` Redis command must use `--maxmemory-policy noeviction`.
After fixing, recreate the Redis container:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d redis
docker compose -f docker-compose.prod.yml restart app
```

### App crashes with ESM import errors

The NestJS app uses ESM (`"type": "module"`) with `tsc` compiler (not SWC).
The `nest-cli.json` must **not** have `"builder": "swc"` — SWC strips `/index.js`
barrel imports which breaks ESM resolution at runtime.

### Health check returns unhealthy

```bash
# Check which dependency is down
curl -s http://localhost:3000/health | python3 -m json.tool

# Check individual container logs
docker compose -f docker-compose.prod.yml logs --tail=50 postgres
docker compose -f docker-compose.prod.yml logs --tail=50 redis
docker compose -f docker-compose.prod.yml logs --tail=50 minio
```
