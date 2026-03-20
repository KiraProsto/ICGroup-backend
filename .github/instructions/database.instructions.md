---
applyTo: "**/*prisma*,**/*.sql,**/prisma/**/*.ts,prisma/schema.prisma"
---

Database rules for Prisma 7 / PostgreSQL 16:

Prisma 7 specifics:
- Generated client lives in `src/generated/prisma/` — import from `@generated/prisma/client.js`.
- Driver adapter: `@prisma/adapter-pg` with `pg.Pool` — configured in `PrismaService`.
- `prisma.config.ts` in project root is required for CLI commands.
- Never instantiate PrismaClient outside `PrismaService` — use the singleton from `PrismaModule`.
- ESM imports: use `.js` extension when importing from generated client.

Schema patterns in this project:
- Soft deletes: `deletedAt DateTime?` on User, NewsArticle — always filter `deletedAt: null` in queries.
- JSONB columns: `data Json` on PageSection (section content), `body Json` on NewsArticle (ProseMirror doc).
- Enums: Role, ContentStatus, PageType, SectionType, PurchaseStatus, AuditAction, AuditResourceType, AuditLogStatus.
- Monetary values: `Decimal(15,2)` — never Float.
- Unique constraints at DB level: User.email, NewsArticle.slug, Page.type.
- Cascading deletes: PageSection cascades on Page delete.
- FTS: `body_tsv` tsvector column + GIN index on NewsArticle for Russian full-text search.

Safety:
- Assume schema changes can cause downtime, lock contention, or data loss.
- Call out destructive changes clearly.
- Prefer phased migrations for risky changes (rename → add + backfill + drop).
- Migration files go in `prisma/migrations/` — use `npm run prisma:migrate` for dev, `npm run prisma:deploy` for production.

Querying:
- Select only needed fields — avoid returning full JSONB bodies in list queries.
- Avoid N+1 patterns — use `include` or `select` deliberately.
- Paginate all list queries by default.
- Use Prisma transactions (`prisma.$transaction`) when multiple writes must succeed atomically.

Integrity:
- Enforce invariants at the database level where appropriate.
- AuditLog uses nullable `actorId` FK (soft reference) — survives actor deletion.
- Consider concurrent writes and race conditions, especially on publish/archive flows.

Performance:
- Consider indexes for filtering, sorting, and hot paths.
- The existing schema has indexes on FKs, unique fields, and FTS.
- Call out potentially expensive scans or full-table operations.

Security:
- Never construct raw SQL from untrusted input — use Prisma's parameterized `$queryRawUnsafe` only with bound parameters.
- Be mindful of row ownership (createdById) and role-based visibility.

MCP tool usage:
- MUST use Context7 (`mcp_upstash_conte_*`) to look up Prisma 7 documentation before modifying schema, writing migrations, or using advanced query features (raw queries, transactions, driver adapter API).
- Prisma 7 has breaking changes from v5/v6 — always verify API with Context7 instead of assuming.