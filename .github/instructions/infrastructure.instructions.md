---
applyTo: "**/{Dockerfile,docker-compose*.yml,docker-entrypoint.sh,*.yaml,*.yml}"
---

Infrastructure rules for this Docker Compose project:

Local development stack (docker-compose.yml):
- `app`: Node.js 22-alpine, multi-stage build (deps → dev → builder → production), port 3000.
- `postgres`: PostgreSQL 16-alpine, port 15432→5432, pgdata volume, health check via `pg_isready`.
- `redis`: Redis 7-alpine, AOF persistence (required for token allowlist durability), port 6379.
- `minio`: MinIO S3-compatible, API port 9000, console port 9001, miniodata volume.

Dockerfile:
- Multi-stage: deps (native bindings like argon2), development (hot reload), builder (SWC), production (prune dev deps).
- Entrypoint: `docker-entrypoint.sh` runs `prisma migrate deploy` before starting Node.
- Health check: `GET /health` endpoint.
- Do not run as root in production stage.
- Do not bake secrets into images — all config via environment variables.

Config:
- All env vars validated at startup via Joi (`@nestjs/config`) — missing vars cause immediate crash.
- Required: DATABASE_URL, JWT_ACCESS_SECRET (min 32 chars), JWT_REFRESH_SECRET, REDIS_HOST, MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY.
- Distinguish optional vs required in Joi schemas — fail-fast on missing required vars.

Safety:
- Prefer reproducible builds — pin base image versions.
- Keep images deterministic and avoid unnecessary packages.
- Never expose MinIO credentials or JWT secrets in logs or build output.
- `prisma migrate deploy` in entrypoint must be idempotent (it is by design).

MCP tool usage:
- Use Chrome DevTools (`mcp_io_github_chr_*`) or Playwright (`mcp_mcp_docker_browser_*`) to verify health checks and Swagger UI after Docker Compose changes.
- Use Context7 (`mcp_upstash_conte_*`) to look up Docker, PostgreSQL, or Redis configuration options when modifying docker-compose.yml or Dockerfiles.