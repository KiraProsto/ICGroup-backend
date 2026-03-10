---
applyTo: "src/**/*.ts"
---

Backend rules for this NestJS 11 / Prisma 7 / ESM project:

Module structure:
- Thin controllers, focused services, DTOs for input/output.
- Module boundary rule: never import a service from another module directly — only consume what is exported from that module.
- `@Global() PrismaModule` provides `PrismaService` — never instantiate PrismaClient elsewhere.
- All routes protected by default via `JwtAuthGuard`; use `@Public()` to opt out.
- RBAC via `PoliciesGuard` + CASL — enforce at guard level, not in service logic.

ESM and imports:
- All relative imports must use `.js` extensions (ESM requirement).
- Use path aliases: `@common/*`, `@config/*`, `@modules/*`, `@generated/*`.

Validation and contracts:
- Global `ValidationPipe` with `forbidNonWhitelisted: true` — unexpected fields are rejected.
- Use `class-validator` decorators on DTOs for all external input.
- Joi schemas validate env vars at startup (in config files).
- Preserve API compatibility unless explicitly asked to change it.
- Add `@nestjs/swagger` decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`) on all controller methods.

Data patterns:
- JSONB storage for page section `data` and news article `body` (ProseMirror doc).
- Soft deletes via `deletedAt` on User and NewsArticle — filter in queries.
- `Decimal(15,2)` for monetary amounts — never use `Float`.
- Paginate list endpoints by default.
- Select only needed fields in Prisma queries — avoid loading heavy relations.

Security:
- Enforce auth and authorization explicitly — never trust client-supplied roles, tenant IDs, or ownership markers.
- Password hashing: Argon2id (not bcrypt).
- Refresh tokens: HttpOnly SameSite=Strict cookie; allowlist in Redis.
- Be careful with unsafe object spread, mass assignment, and raw query construction.

Errors and resilience:
- Do not swallow errors.
- Throw NestJS HTTP exceptions with meaningful messages (no internal details to clients).
- Log actionable context (entity ID, operation), but never secrets or PII.
- Be explicit about retryability, idempotency, and failure handling.
- BullMQ job handlers must be idempotent — jobs can be retried and duplicated.

Async and concurrency:
- Await intentionally — avoid accidental sequential awaits when safe parallelism exists.
- Consider race conditions around writes, jobs, and external APIs.
- Use Prisma transactions where multiple writes must succeed atomically.

Performance:
- Avoid N+1 patterns — use `include` or `select` deliberately.
- Avoid loading heavy relations (JSONB body, sections) unless needed.
- Consider indexes and query selectivity when access patterns change.

MCP tool usage:
- MUST use Context7 (`mcp_upstash_conte_*`) to look up NestJS, Prisma 7, CASL, class-validator, and @nestjs/swagger documentation before generating or modifying controllers, services, DTOs, guards, or interceptors.
- When unsure about NestJS module wiring, decorator usage, or Prisma query API — query Context7 first, do not guess.