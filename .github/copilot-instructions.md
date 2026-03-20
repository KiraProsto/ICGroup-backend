You are working in the ICGroup Backend — a NestJS modular monolith (REST API, no GraphQL) with PostgreSQL 16, Redis 7, and MinIO/S3-compatible storage. There is no frontend in this repo.

Tech stack:
- Runtime: Node.js 20 LTS, TypeScript 5.7, ESM-only (`"type": "module"`, `.js` extensions in all imports)
- Framework: NestJS 11 with Guards, Interceptors, Pipes, global ValidationPipe (`forbidNonWhitelisted: true`)
- ORM: Prisma 7 with `@prisma/adapter-pg` driver adapter, generated client in `src/generated/prisma/`
- Auth: JWT (access 15min + refresh 7d with rotation), Passport, Argon2id hashing
- RBAC: CASL 6 attribute-level policies — roles: SUPER_ADMIN, CONTENT_MANAGER, SALES_MANAGER
- Async: BullMQ on Redis for audit log processing
- Validation: class-validator + Joi (env vars at startup)
- API docs: Swagger/OpenAPI via @nestjs/swagger
- Rate limiting: @nestjs/throttler with Redis store
- Rich text: Tiptap/ProseMirror JSON (XSS-safe by design — server renders HTML from JSON)
- Security headers: Helmet
- Container: Docker Compose (PostgreSQL 16, Redis 7, MinIO, Node app)

Key conventions:
- Singleton PrismaService via `@Global() PrismaModule` — never instantiate PrismaClient elsewhere.
- All config via `@nestjs/config` + Joi schemas — fail-fast on missing env vars.
- Path aliases: `@common/*`, `@config/*`, `@modules/*`, `@generated/*`.
- Soft deletes via `deletedAt` on User, NewsArticle.
- JSONB for page section `data` and news article `body` (ProseMirror doc).
- Module boundary rule: no cross-module service imports — only what's exported from the module.
- Refresh token allowlist + family rotation detection in Redis.
- CASL ability cache per user in Redis (TTL 300s).

Security baseline:
- Never weaken auth, authorization, CSRF, CORS, or validation without explicitly calling out the risk.
- Never log secrets, tokens, password hashes, or PII.
- Redact sensitive values in logs and error responses.
- Treat all external input as hostile: HTTP params, headers, cookies, file uploads, env vars.

Reliability:
- Prefer idempotent operations.
- BullMQ jobs can be retried and duplicated — handlers must be idempotent.
- Security-critical audit events (login, logout, role changes) are logged synchronously; operational events go through BullMQ.
- Preserve backward compatibility unless explicitly asked not to.

When modifying code:
- Understand local context, dependencies, and failure modes first.
- Check whether the change affects: REST API contracts, auth/authorization, validation, Prisma schema, migrations, BullMQ jobs, Redis keys, Docker setup, tests.
- Keep backward compatibility unless explicitly told otherwise.
- Update related types, validation, tests, and OpenAPI decorators.

When reviewing code:
- Prioritize by severity: Critical, High, Medium, Low.
- Look for: correctness bugs, security issues, data loss risks, edge-case failures, poor typing, N+1 queries, missing observability, missing tests.

When generating code:
- Use ESM imports with `.js` extensions for all relative imports.
- Use NestJS patterns: thin controllers, focused services, DTOs for input/output.
- Enforce auth at guard level, RBAC via CASL policies.
- Paginate list endpoints by default.
- Prefer production-safe defaults; make dangerous behavior explicit.
- For BullMQ jobs, assume retries and duplicates.

Output style:
- Be concise but precise.
- For code review, group findings by severity.
- For implementation, briefly explain tradeoffs, then provide code.
- Call out security or production risks explicitly.

MCP tool usage (mandatory):
- Context7 (`mcp_upstash_conte_*`): MUST use to look up latest documentation before implementing features with NestJS, Prisma, CASL, BullMQ, class-validator, Tiptap, Argon2, Passport, Helmet, or any unfamiliar project dependency. Always call `resolve-library-id` first, then `query-docs` with the resolved ID.
- Chrome DevTools (`mcp_io_github_chr_*`): Use to test the running API — Swagger UI at `localhost:3000/api`, health check at `localhost:3000/health`, or any REST endpoint. Take snapshots/screenshots to verify behavior.
- Playwright browser (`mcp_mcp_docker_browser_*`): Alternative to Chrome DevTools for browser-based API testing and Swagger UI verification.
- Vercel/Next.js tools (`mcp_io_github_ver_*`): NOT applicable — this is a NestJS backend, not Next.js. Never use these tools.