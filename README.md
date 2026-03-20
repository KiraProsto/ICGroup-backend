# ICGroup Backend

**Modular monolith REST API** for the ICGroup admin panel and public portal.

Built with NestJS 11, Prisma 7, PostgreSQL 16, Redis 7, and MinIO/S3-compatible object storage. Serves three user roles — Super Admin, Content Manager, and Sales Manager — plus read-only public endpoints consumed by a separate portal frontend.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Getting Started](#getting-started)
5. [Environment Variables](#environment-variables)
6. [Docker Setup](#docker-setup)
7. [Database](#database)
8. [API Reference](#api-reference)
9. [Authentication & Authorization](#authentication--authorization)
10. [Rate Limiting](#rate-limiting)
11. [Health Checks](#health-checks)
12. [Audit Logging](#audit-logging)
13. [Rich Text (Tiptap / ProseMirror)](#rich-text-tiptap--prosemirror)
14. [File Storage (MinIO / S3)](#file-storage-minio--s3)
15. [Testing](#testing)
16. [CI / CD](#ci--cd)
17. [Production Deployment](#production-deployment)
18. [Scripts Reference](#scripts-reference)
19. [Contributing](#contributing)

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js (LTS) | 24 |
| Language | TypeScript (ESM-only) | 5.7 |
| Framework | NestJS | 11 |
| ORM | Prisma (driver-adapter mode) | 7 |
| Database | PostgreSQL | 16 |
| Cache / Queue | Redis (AOF persistence) | 7 |
| Object Storage | MinIO (S3-compatible) | — |
| Auth | JWT + Passport + Argon2id | — |
| RBAC | CASL 6 (attribute-level policies) | 6 |
| Job Queue | BullMQ | 5 |
| Rich Text | Tiptap / ProseMirror (server-side rendering) | 3 |
| API Docs | Swagger / OpenAPI via @nestjs/swagger | — |
| Logging | Pino (structured JSON) via nestjs-pino | — |
| Rate Limiting | @nestjs/throttler (Redis-backed Lua script) | 6 |
| Security Headers | Helmet | 8 |
| Containerization | Docker (multi-stage) + Docker Compose | — |
| CI | GitHub Actions | — |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Docker Compose / Kubernetes                   │
│                                                                  │
│  ┌──────────────┐     ┌────────────────────────────────────┐    │
│  │ Admin        │     │        NestJS Application           │    │
│  │ Frontend     │────▶│                                    │    │
│  └──────────────┘     │  ┌────────┐ ┌──────────────────┐  │    │
│                       │  │  Auth  │ │  Content (Pages,  │  │    │
│  ┌──────────────┐     │  │ Module │ │  News, Media)     │  │    │
│  │ Public       │     │  └────────┘ └──────────────────┘  │    │
│  │ Portal       │────▶│  ┌────────┐ ┌──────────────────┐  │    │
│  └──────────────┘     │  │ Users  │ │  Sales (Company,  │  │    │
│                       │  │ Module │ │  Purchase)        │  │    │
│                       │  └────────┘ └──────────────────┘  │    │
│                       │  ┌────────┐ ┌──────────────────┐  │    │
│                       │  │ Audit  │ │  Public API       │  │    │
│                       │  │ Module │ │  (read-only)      │  │    │
│                       │  └────────┘ └──────────────────┘  │    │
│                       └──────┬──────────┬──────────┬──────┘    │
│                              │          │          │            │
│                    ┌─────────┘          │          └─────────┐  │
│                    ▼                    ▼                    ▼  │
│             ┌────────────┐      ┌───────────┐      ┌─────────┐ │
│             │ PostgreSQL │      │  Redis 7  │      │  MinIO  │ │
│             │     16     │      │  (AOF)    │      │  (S3)   │ │
│             └────────────┘      └───────────┘      └─────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **Modular monolith** — feature modules are the isolation boundary, not microservices. Clean module boundaries allow extraction later if needed.
- **Single NestJS process** — all API routes served from one app. The `PublicModule` exposes read-only endpoints for the portal team via the same database.
- **Contract-first API** — OpenAPI/Swagger spec is the integration contract with frontend teams.
- **Security by default** — auth, RBAC, audit logging, and input validation baked in from day one.

---

## Project Structure

```
src/
├── main.ts                        # Bootstrap: trust proxy, Swagger, graceful shutdown
├── app.module.ts                  # Root module: config, logging, throttle, imports
├── app.controller.ts              # Root (/) and health (/health) endpoints
├── app.setup.ts                   # Global prefix, versioning, pipes, filters, interceptors
├── app.service.ts                 # API info response
│
├── common/
│   ├── constants/                 # Shared constants (audit action names, etc.)
│   ├── dto/                       # ApiResponseDto, ApiErrorResponseDto, AppInfoDto
│   ├── filters/                   # AllExceptionsFilter (unified error envelope)
│   ├── interceptors/              # TransformResponseInterceptor (success envelope)
│   ├── pipes/                     # ParseSlugPipe (slug validation)
│   ├── tiptap/                    # Tiptap/ProseMirror extension set + sanitizer
│   ├── utils/                     # withTimeout(), shared helpers
│   ├── throttler-storage.ts       # Redis-backed throttler (Lua script, atomic)
│   └── throttler-storage.spec.ts
│
├── config/
│   ├── app.config.ts              # PORT, NODE_ENV, CORS, log level, shutdown timeout
│   ├── auth.config.ts             # JWT secrets, TTLs
│   ├── database.config.ts         # DATABASE_URL, pool settings
│   ├── redis.config.ts            # REDIS_HOST, REDIS_PORT, REDIS_PASSWORD
│   ├── storage.config.ts          # MinIO endpoint, bucket, public URL
│   └── throttle.config.ts         # Rate-limit windows and limits
│
├── generated/prisma/              # Auto-generated Prisma client (not committed)
│
├── modules/
│   ├── audit/                     # Audit log: interceptor, BullMQ queue, processor
│   ├── auth/                      # JWT auth: login, refresh, logout, guards, strategies
│   ├── casl/                      # RBAC: CASL ability factory, PoliciesGuard
│   ├── health/                    # Terminus health indicators (DB, Redis, Storage)
│   ├── media/                     # File upload (multipart → MinIO)
│   ├── news/                      # News articles: CRUD, lifecycle, FTS, cards
│   ├── pages/                     # Dynamic pages: CRUD, sections, lifecycle
│   ├── public/                    # Public portal API (read-only, no auth)
│   ├── storage/                   # MinIO/S3 client wrapper
│   └── users/                     # User management (SUPER_ADMIN only)
│
├── prisma/
│   ├── prisma.module.ts           # @Global() PrismaModule (singleton)
│   └── prisma.service.ts          # PrismaService with driver adapter
│
└── redis/
    ├── redis.module.ts            # @Global() RedisModule (singleton ioredis client)
    └── index.ts

prisma/
├── schema.prisma                  # Database schema (models, enums, indexes)
├── prisma.config.ts               # Prisma v7 CLI configuration
├── seed.ts                        # Idempotent seed: creates default Super Admin
└── migrations/                    # Sequential SQL migrations

test/
└── app.e2e-spec.ts                # E2E tests (supertest)
```

---

## Getting Started

### Prerequisites

- **Node.js** 24 LTS
- **Docker** and **Docker Compose** (for PostgreSQL, Redis, MinIO)
- **npm** (comes with Node.js)

### Local Development (Docker Compose)

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd icgroup-backend
   ```

2. **Start infrastructure services:**

   The project ships with a `.env.development` file containing safe defaults that match `docker-compose.yml`. No manual env file setup required for local development.

   ```bash
   docker compose up -d postgres redis minio
   ```

3. **Install dependencies and generate Prisma client:**

   ```bash
   npm ci
   npm run prisma:generate
   ```

4. **Run database migrations:**

   ```bash
   npm run prisma:migrate
   ```

5. **Seed the database (optional):**

   Requires `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` environment variables:

   ```bash
   SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=YourStrongPassword npm run prisma:seed
   ```

6. **Start the dev server:**

   ```bash
   npm run start:dev
   ```

   The API is available at `http://localhost:3000/api/v1` and Swagger docs at `http://localhost:3000/api/docs` (development only).

### Full Docker Development

To run the entire stack (app + all dependencies) inside Docker:

```bash
docker compose up
```

The dev entrypoint script handles dependency installation automatically. Hot reload is supported via volume mounts.

---

## Environment Variables

All environment variables are validated at startup using Joi schemas. The application fails fast with descriptive errors if required variables are missing or invalid.

### Configuration Files

| File | Purpose | Committed |
|---|---|---|
| `.env.development` | Safe docker-compose defaults for local dev | Yes |
| `.env.development.local` | Per-developer local overrides | No (gitignored) |
| `.env.staging` | Staging environment values | No (gitignored) |
| `.env.production` | Production environment values | No (gitignored) |
| `.env.staging.example` | Staging template (copy and fill) | Yes |
| `.env.production.example` | Production template (copy and fill) | Yes |

Env file loading order (first match wins, process env vars always take precedence):

```
.env.{NODE_ENV}.local → .env.{NODE_ENV} → .env.local → .env
```

### Required Variables

| Variable | Description | Default |
|---|---|---|
| `NODE_ENV` | `development`, `staging`, `production`, `test` | `development` |
| `PORT` | HTTP listen port | `3000` |
| `DATABASE_URL` | PostgreSQL connection string | — (required) |
| `JWT_ACCESS_SECRET` | Access token signing key (min 32 chars) | — (required) |
| `JWT_REFRESH_SECRET` | Refresh token signing key (min 32 chars) | — (required) |
| `MINIO_ACCESS_KEY` | MinIO/S3 access key (min 8 chars) | — (required) |
| `MINIO_SECRET_KEY` | MinIO/S3 secret key (min 16 in prod/staging) | — (required) |

### Optional Variables

| Variable | Description | Default |
|---|---|---|
| `CORS_ORIGINS` | Comma-separated allowed origins | `http://localhost:5173` |
| `LOG_LEVEL` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` | `info` (prod/staging), `debug` (dev) |
| `REDIS_HOST` | Redis hostname | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Redis AUTH password (min 16 in prod/staging) | — |
| `JWT_ACCESS_EXPIRES_IN` | Access token TTL | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL | `7d` |
| `MINIO_ENDPOINT` | MinIO/S3 endpoint | `localhost` |
| `MINIO_PORT` | MinIO/S3 port | `9000` |
| `MINIO_USE_SSL` | Use HTTPS for storage | `false` |
| `MINIO_BUCKET_CONTENT` | Content images bucket name | `content-images` |
| `MINIO_PUBLIC_URL` | CDN/S3 base URL for serving objects | auto-generated |
| `DB_POOL_MAX` | Max PostgreSQL connection pool size | `10` |
| `DB_POOL_CONNECT_TIMEOUT_MS` | Pool connection timeout | `3000` |
| `DB_POOL_IDLE_TIMEOUT_MS` | Idle connection timeout | `10000` |
| `DB_STATEMENT_TIMEOUT_MS` | SQL statement timeout | `30000` |
| `THROTTLE_TTL` | Global rate-limit window (seconds) | `60` |
| `THROTTLE_LIMIT` | Max requests per global window | `120` |
| `THROTTLE_LOGIN_TTL` | Login rate-limit window (seconds) | `60` |
| `THROTTLE_LOGIN_LIMIT` | Max login attempts per window | `5` |
| `TRUST_PROXY` | Trust one reverse-proxy hop for `req.ip` | `false` |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown deadline before forced exit | `10000` |

> **Security note:** Never commit real secrets. In CI/CD, inject secrets via platform-native mechanisms (Kubernetes Secrets, AWS Parameter Store, Vault, etc.).

---

## Docker Setup

### Docker Compose Services

| Service | Image | Ports | Purpose |
|---|---|---|---|
| `app` | Built from Dockerfile (dev target) | `3000` | NestJS application (hot reload) |
| `postgres` | `postgres:16-alpine` | `15432` (localhost only) | Primary database |
| `redis` | `redis:7-alpine` (AOF enabled) | `6379` (localhost only) | Cache, token store, job queue |
| `minio` | `minio/minio` | `9000` (S3 API), `9001` (console) | Object storage |

All services are on an isolated `icgroup-net` bridge network. Database ports are bound to `127.0.0.1` to prevent external access.

### Multi-Stage Dockerfile

| Stage | Base | Purpose |
|---|---|---|
| `deps` | `node:24-alpine` | Install npm dependencies + native build tools (argon2) |
| `development` | `node:24-alpine` | Hot-reload dev server, volume mounts |
| `builder` | `node:22-alpine` | Compile TypeScript, generate Prisma client |
| `production` | `node:24-alpine` | Minimal runtime — runs migrations on startup, non-root user (`nestjs:1001`) |

**Production image features:**
- Runs `prisma migrate deploy` on startup via entrypoint
- Non-root user (`nestjs:1001`)
- Built-in `HEALTHCHECK` (GET /health every 30s)
- Dev dependencies pruned (`npm prune --omit=dev`)

### Commands

```bash
# Start all services (dev)
docker compose up

# Start infrastructure only
docker compose up -d postgres redis minio

# Rebuild after Dockerfile changes
docker compose up --build

# Build production image
docker build --target production -t icgroup-backend:latest .
```

---

## Database

### ORM: Prisma 7

Prisma 7 uses the **driver-adapter architecture** — the query engine runs as a WASM module with an explicit `@prisma/adapter-pg` driver. This eliminates platform-specific Rust binaries and reduces the Docker image footprint.

- **Generated client**: `src/generated/prisma/` (auto-generated, not committed)
- **Singleton**: `PrismaService` via `@Global() PrismaModule` — never instantiate `PrismaClient` elsewhere
- **Configuration**: `prisma.config.ts` in project root

### Schema Models

| Model | Description | Key Features |
|---|---|---|
| `User` | System users | Roles (enum), soft delete, Argon2id password hash |
| `Page` | Dynamic CMS pages | Slug-based lookup, content lifecycle (draft/published/archived) |
| `PageSection` | Page content blocks | Ordered, 6 types (HERO, FEATURE_GRID, etc.), JSONB `data` |
| `Rubric` | News categories | Slug-based, cascading to articles |
| `NewsArticle` | News/articles/press releases | ProseMirror body (JSONB), FTS via `tsvector`, soft delete |
| `ArticleCard` | Article content cards | 5 types (TEXT, QUOTE, IMAGE, etc.), ordered per article |
| `Company` | Business entities | INN (tax ID), industry, notes |
| `Purchase` | Sales records | Decimal(15,2) amounts, status workflow |
| `AuditLog` | Immutable audit trail | Actor, action, resource, before/after snapshots (JSONB) |

### Enums

```
Role:            SUPER_ADMIN | CONTENT_MANAGER | SALES_MANAGER
ContentStatus:   DRAFT | PUBLISHED | ARCHIVED
SectionType:     HERO | FEATURE_GRID | TESTIMONIALS | CTA | TEXT | GALLERY
PurchaseStatus:  PENDING | CONFIRMED | CANCELLED
ArticleType:     NEWS | ARTICLE | PRESS_RELEASE | INTERVIEW | ANNOUNCEMENT
ArticleCardType: TEXT | QUOTE | PUBLICATION | IMAGE | VIDEO
AuditAction:     CREATE | UPDATE | DELETE | LOGIN | LOGOUT | PUBLISH | ARCHIVE
```

### Migrations

Migrations are managed via `prisma migrate dev` (development) and `prisma migrate deploy` (production). Production deployments run migrations automatically in the Docker entrypoint.

| Migration | Summary |
|---|---|
| `20260302123207_init` | Initial schema — User, Page, PageSection, NewsArticle, Company, Purchase, AuditLog |
| `20260309000001_remove_redundant_indexes` | Index cleanup |
| `20260309000002_add_news_fts` | Full-text search: `body_tsv` tsvector + GIN index (Russian config) |
| `20260310000001_add_purchase_created_by_idx` | Index on `Purchase.createdById` |
| `20260311000001_add_content_metadata` | Social meta (JSONB), RSS flags, publication index |
| `20260311103802_articles` | Article types, rubric foreign key |
| `20260312152604_pages_dynamic_slug_name` | Dynamic slug + name for pages |
| `20260313111622_mainframe` | Company, Purchase, Rubric models |
| `20260313120001_add_article_cards` | ArticleCard model |
| `20260320121149_constrain_audit_ip_ua_length` | Constrain IP (45 chars) and UserAgent (512 chars) |

### Seeding

```bash
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=<strong-password> npm run prisma:seed
```

The seed script is **idempotent** — it upserts a Super Admin user with an Argon2id-hashed password. Safe to run multiple times.

---

## API Reference

### Base URL

All API routes are prefixed with `/api/v1` and use URI versioning. The `/health` endpoint is excluded from the prefix.

Swagger UI is available at `GET /api/docs` in development environments only (disabled in production and staging).

### Response Envelopes

**Success:**

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "timestamp": "2026-03-20T12:00:00.000Z",
    "path": "/api/v1/..."
  }
}
```

**Paginated:**

```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "timestamp": "2026-03-20T12:00:00.000Z",
    "path": "/api/v1/...",
    "total": 42,
    "page": 1,
    "perPage": 20,
    "totalPages": 3
  }
}
```

**Error:**

```json
{
  "success": false,
  "error": {
    "code": 400,
    "message": "Validation failed",
    "details": [ "title must be a string" ]
  },
  "meta": {
    "timestamp": "2026-03-20T12:00:00.000Z",
    "path": "/api/v1/..."
  }
}
```

### Endpoints

#### Meta & Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1` | Public | API info (name, version, status) |
| `GET` | `/health` | Public | Liveness probe — checks DB, Redis, Storage |

#### Authentication (`/api/v1/auth`)

| Method | Path | Auth | Throttle | Description |
|---|---|---|---|---|
| `POST` | `/auth/login` | Public | Login (5/min) | Authenticate, returns access token + sets refresh cookie |
| `POST` | `/auth/refresh` | Public | Login (5/min) | Rotate tokens (refresh cookie required) |
| `POST` | `/auth/logout` | Public | Global only | Revoke refresh token, clear cookie |
| `GET` | `/auth/me` | JWT | Global only | Current user profile |

#### Users (`/api/v1/admin/users`) — SUPER_ADMIN only

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/users` | List users (paginated) |
| `POST` | `/admin/users` | Create user |
| `GET` | `/admin/users/:id` | Get user by ID |
| `PATCH` | `/admin/users/:id` | Update user (role, active, password) |
| `DELETE` | `/admin/users/:id` | Soft-delete user |
| `POST` | `/admin/users/:id/restore` | Restore soft-deleted user |

#### Pages (`/api/v1/admin/content/pages`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/content/pages` | List pages (paginated) |
| `POST` | `/admin/content/pages` | Create page (DRAFT) |
| `GET` | `/admin/content/pages/:slug` | Get page with sections |
| `PATCH` | `/admin/content/pages/:slug` | Update page name |
| `PUT` | `/admin/content/pages/:slug` | Replace all sections |
| `POST` | `/admin/content/pages/:slug/publish` | Publish page |
| `POST` | `/admin/content/pages/:slug/archive` | Archive page |

#### News Articles (`/api/v1/admin/content/news`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/content/news` | List articles (paginated, filtered) |
| `POST` | `/admin/content/news` | Create article (DRAFT) |
| `GET` | `/admin/content/news/search` | Full-text search (PostgreSQL tsvector) |
| `GET` | `/admin/content/news/:id` | Get article with cards |
| `PATCH` | `/admin/content/news/:id` | Update article |
| `DELETE` | `/admin/content/news/:id` | Soft-delete article |
| `POST` | `/admin/content/news/:id/publish` | Publish article (renders HTML from ProseMirror) |
| `POST` | `/admin/content/news/:id/draft` | Revert to draft |
| `POST` | `/admin/content/news/:id/archive` | Archive article |
| `GET` | `/admin/content/news/:id/preview` | Live HTML preview |

#### Article Cards (`/api/v1/admin/content/news/:articleId/cards`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/news/:articleId/cards` | List cards (ordered) |
| `POST` | `/news/:articleId/cards` | Create card |
| `PATCH` | `/news/:articleId/cards/:cardId` | Update card |
| `DELETE` | `/news/:articleId/cards/:cardId` | Delete card |
| `PUT` | `/news/:articleId/cards/order` | Reorder cards |

#### Media (`/api/v1/admin/content/media`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/admin/content/media/upload` | Upload image (5 MiB max, validated MIME type) |

#### Audit Logs (`/api/v1/admin/audit`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/admin/audit` | List audit logs (paginated, filtered by actor/action/resource/date) |

#### Public Portal (`/api/v1/public`) — No authentication

| Method | Path | Description |
|---|---|---|
| `GET` | `/public/pages/:slug` | Get published page with sections |
| `GET` | `/public/news` | List published articles (paginated, filterable) |
| `GET` | `/public/news/:slug` | Get published article (includes pre-rendered HTML) |

---

## Authentication & Authorization

### JWT Token Flow

1. **Login** (`POST /auth/login`) — validates credentials using constant-time Argon2id comparison
2. **Access Token** (15 min TTL) — returned in the response body, sent as `Authorization: Bearer <token>` on subsequent requests
3. **Refresh Token** (7 day TTL) — stored in an `HttpOnly`, `SameSite=Strict`, `Secure` cookie at path `/api/v1/auth`
4. **Refresh** (`POST /auth/refresh`) — rotates both tokens, detects reuse via family tracking
5. **Logout** (`POST /auth/logout`) — revokes the refresh token in Redis, clears the cookie

### Token Storage (Redis)

| Key Pattern | Purpose | TTL |
|---|---|---|
| `rt:{jti}` | Refresh token allowlist entry | 7 days |
| `rt-family:{familyId}:{jti}` | Token family member (reuse detection) | 7 days |

**Reuse detection:** If a refresh token that has already been consumed (rotated) is presented again, the entire token family is revoked — forcing all sessions in that family to re-authenticate.

### RBAC (CASL 6)

Attribute-level access control enforced globally via `PoliciesGuard`:

| Role | Permissions |
|---|---|
| **SUPER_ADMIN** | Full access to all resources |
| **CONTENT_MANAGER** | Manage pages, news, rubrics, media; read users, audit logs |
| **SALES_MANAGER** | Manage companies, purchases; read pages, news, users, audit logs |

Abilities are cached in Redis (`casl:ability:{userId}:{role}`, TTL 5 min) and invalidated on role or status changes.

### Guard Execution Order

1. **ThrottlerGuard** — rate limiting (runs before auth to reject floods early)
2. **JwtAuthGuard** — validates access token, loads user from DB
3. **PoliciesGuard** — evaluates `@CheckPolicies()` decorators against the user's CASL ability

---

## Rate Limiting

Two named throttlers backed by Redis (shared across all application instances):

| Throttler | Window | Limit | Applied To |
|---|---|---|---|
| `global` | 60s | 120 requests | All routes (default) |
| `login` | 60s | 5 requests | `POST /auth/login`, `POST /auth/refresh` only |

Rate-limit state is stored in Redis via an atomic Lua script that handles increment, TTL, and block flag in a single round-trip. When the limit is exceeded, the tracker is blocked for the remainder of the window.

Controllers that should not count against the login throttler use `@SkipThrottle({ login: true })`. Routes exempt from all throttling use `@SkipThrottle()` (e.g., `/health`).

**Reverse proxy:** When deployed behind nginx, ALB, or similar, set `TRUST_PROXY=true` so `req.ip` reflects the real client IP instead of the proxy address.

---

## Health Checks

**Endpoint:** `GET /health` (no `/api` prefix, `VERSION_NEUTRAL`)

Checks three dependencies and returns 200 only when all pass, 503 if any fail:

| Indicator | Check | Timeout |
|---|---|---|
| **Database** | `SELECT 1` via Prisma | 5 seconds |
| **Redis** | `PING` → expects `PONG` | 5 seconds |
| **Storage** | MinIO bucket existence | 5 seconds |

Used by:
- Docker `HEALTHCHECK` (every 30s, 3 retries)
- Load balancer liveness/readiness probes
- Monitoring systems

The health endpoint bypasses the response envelope — it returns raw Terminus JSON for compatibility with standard probe tools.

---

## Audit Logging

Every mutation in the system is logged to an immutable `AuditLog` table.

### Two Modes

| Mode | Use Case | Mechanism |
|---|---|---|
| **Synchronous** | Security-critical events (login, logout, role changes) | Direct DB write in the same request |
| **Asynchronous** | Operational events (CRUD on content, companies, purchases) | BullMQ job (`audit-queue`) |

### Captured Data

- **Actor:** user ID, IP address (45 chars max), User-Agent (512 chars max)
- **Action:** CREATE, UPDATE, DELETE, LOGIN, LOGOUT, PUBLISH, ARCHIVE
- **Resource:** type + ID
- **Snapshots:** before/after state (JSONB) with secrets and password hashes stripped
- **Status:** SUCCESS or FAILURE

### Queue Configuration

- **Queue:** `audit-queue` (BullMQ on Redis)
- **Retries:** 3 attempts with exponential backoff
- **Idempotency:** Job ID = `audit-{auditId}` — duplicate deliveries are safely ignored
- **Cleanup:** Completed jobs retained (1000 count), failed jobs retained (5000 count)

### Interceptor

`AuditInterceptor` is registered globally and runs after every HTTP mutation that carries the `@Audit()` decorator. It captures request/response context and dispatches the audit job. Failures in audit logging are logged but never affect the client response.

---

## Rich Text (Tiptap / ProseMirror)

News article bodies are stored as **ProseMirror JSON** in a JSONB column — not raw HTML. This is XSS-safe by design.

### Extension Set

StarterKit, TextStyle, Color, Highlight (multicolor), TextAlign, Image, Table

### Rendering Pipeline

1. **Author writes** content in the admin panel (Tiptap editor)
2. **Backend stores** the ProseMirror JSONContent document in `body` (JSONB)
3. **On publish**, the server renders HTML via `@tiptap/html` with a strict extension allowlist → stored in `bodyHtml`
4. **Plain text** is extracted for full-text search → stored in `bodyText`, indexed via PostgreSQL `tsvector` with a GIN index
5. **Public API** serves the pre-rendered `bodyHtml` — no client-side rendering required

### Security

- Server-side rendering only (`@tiptap/html/server`)
- `sanitize-html` with strict tag/attribute allowlists
- No raw user HTML stored or rendered
- CSS injection prevented via regex guards on style attributes

---

## File Storage (MinIO / S3)

### Upload Flow

1. Client sends multipart file to `POST /admin/content/media/upload`
2. Server validates MIME type (JPEG, PNG, WebP, GIF, AVIF, PDF) and file size (5 MiB max)
3. Collision-resistant key generated: `{yyyy}/{MM}/{uuid}{ext}` (extension derived from MIME type, not filename)
4. File uploaded to MinIO/S3 with correct Content-Type
5. Public URL returned to the client

### Configuration

- **Dev:** MinIO container via Docker Compose (`localhost:9000`, console at `localhost:9001`)
- **Production:** Any S3-compatible service. Set `MINIO_PUBLIC_URL` for CDN-backed serving.

Bucket existence and public-read policy are verified on module initialization.

---

## Testing

### Test Strategy

| Type | Location | Runner | Purpose |
|---|---|---|---|
| **Unit** | `src/**/*.spec.ts` | Jest + SWC | Service logic, guards, pipes, interceptors |
| **E2E** | `test/*.e2e-spec.ts` | Jest + supertest | Full HTTP request/response cycles |

### Running Tests

```bash
# Unit tests
npm test

# Unit tests (watch mode)
npm run test:watch

# Unit tests with coverage
npm run test:cov

# E2E tests
npm run test:e2e
```

### Mocking Strategy

- **PrismaService** — mocked; never connects to a real database in unit tests
- **Redis** — mocked via `jest.fn()` on ioredis methods
- **ConfigService** — mocked with known test values (never real secrets)
- **StorageService** — mocked; no real MinIO calls in tests
- **BullMQ** — producer and consumer tested independently

---

## CI / CD

### GitHub Actions Pipeline

The CI/CD pipeline runs on every push and pull request to `main`, `master`, and `dev`. On pushes to `main`/`master`, the deploy job automatically deploys to the production VPS:

```
┌─────────┐     ┌─────────────┐     ┌────────────┐     ┌──────────────┐     ┌──────────┐
│  Lint   │────▶│  Unit Tests │────▶│  E2E Tests │────▶│  Docker      │────▶│  Deploy  │
│         │     │  + Coverage │     │  (mocked)  │     │  Build/Push  │     │  (SSH)   │
└─────────┘     └─────────────┘     └────────────┘     └──────────────┘     └──────────┘
```

| Job | Trigger | What it does |
|---|---|---|
| **Lint** | push/PR to main, dev | ESLint, Prettier formatting, TypeScript type check |
| **Unit Tests** | push/PR to main, dev | 285+ tests, coverage report uploaded as artifact |
| **E2E Tests** | after lint | Full HTTP tests with mocked dependencies |
| **Docker** | after all tests | Multi-stage build, push to GHCR (non-PR only) |
| **Deploy** | push to main only | SSH to VPS → pull image → restart → health check |

All jobs run with least-privilege `permissions: contents: read`. Docker images are tagged with commit SHA, branch name, and `latest` (on main/master).

> For full deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Production Deployment

### Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│  VPS (Docker Compose)                                   │
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

| Service | Purpose |
|---|---|
| **Nginx** | Reverse proxy, TLS termination (Let's Encrypt), rate limiting |
| **Certbot** | Automatic Let's Encrypt certificate renewal |
| **Portainer CE** | Docker management UI for DevOps (`:9443`) |
| **Uptime Kuma** | Team-facing status dashboard with alerts (`:3001`) |

### Monitoring & Dashboards

| Dashboard | URL | Audience | Purpose |
|---|---|---|---|
| **Uptime Kuma** | `http://<server>:3001` | Everyone | Service health, uptime history, Telegram/email alerts |
| **Status Page** | `http://<server>:3001/status/icgroup` | Everyone (shareable link) | Public-facing uptime status |
| **Portainer** | `https://<server>:9443` | DevOps / Developers | Container management, logs, restart |
| **GitHub Actions** | GitHub → Actions tab | Developers | CI/CD pipeline runs |
| **Swagger** | `https://<domain>/api` | Developers | API documentation |
| **Health endpoint** | `https://<domain>/health` | Automated checks | Machine-readable health |

> For full deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## Scripts Reference

| Script | Description |
|---|---|
| `npm run build` | Compile TypeScript via NestJS CLI (SWC) |
| `npm start` | Start production server (`node dist/src/main.js`) |
| `npm run start:dev` | Start dev server with hot reload |
| `npm run start:debug` | Start with debug mode + hot reload |
| `npm run lint` | Run ESLint on `src/` and `test/` |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without writing |
| `npm test` | Run unit tests |
| `npm run test:watch` | Run unit tests in watch mode |
| `npm run test:cov` | Run unit tests with coverage report |
| `npm run test:e2e` | Run E2E tests |
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`) |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:migrate` | Run migrations (dev) |
| `npm run prisma:deploy` | Deploy migrations (production) |
| `npm run prisma:studio` | Open Prisma Studio GUI |
| `npm run prisma:seed` | Seed database with default Super Admin |

---

## Contributing

### Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by `commitlint`:

```
feat(module): add new feature
fix(auth): correct token rotation logic
docs: update README
chore: update dependencies
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

### Code Quality

- **ESLint** + **Prettier** — enforced in CI and via `lint-staged` on commit
- **Husky** — Git hooks for pre-commit linting
- **TypeScript strict mode** — `strictNullChecks`, `noImplicitAny`
- **ESM-only** — all relative imports use `.js` extensions
- **Path aliases** — `@common/*`, `@config/*`, `@modules/*`, `@generated/*`

### Module Boundary Rule

Never import a service from another module directly. Only consume what is exported from a module's public API (barrel `index.ts`). This keeps modules decoupled and extractable.

---

## License

MIT
