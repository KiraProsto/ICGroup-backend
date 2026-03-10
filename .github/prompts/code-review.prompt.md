Review the attached code thoroughly.

Focus on:
- correctness
- edge cases
- TypeScript typing quality
- security
- performance
- maintainability
- architecture fit
- observability
- production safety
- test coverage gaps

Project context:
- Backend: NestJS 11, REST API (no GraphQL), ESM-only with `.js` extensions
- ORM: Prisma 7 with PrismaPg driver adapter, generated client in `src/generated/prisma/`
- Database: PostgreSQL 16 (JSONB, FTS, soft deletes)
- Auth: JWT (access 15min + refresh 7d rotation), Argon2id, CASL RBAC
- Async: Redis 7, BullMQ (audit queue)
- Storage: MinIO / S3-compatible
- Infra: Docker Compose
- Rich text: Tiptap/ProseMirror JSON (server-side HTML generation)

Instructions:
- Prioritize issues by severity: Critical, High, Medium, Low.
- Be concrete and specific.
- Point to exact suspicious lines or patterns when possible.
- For each issue, explain:
  1. what is wrong
  2. why it matters
  3. how to fix it
- Mention good decisions briefly, but focus on real risks.
- Do not invent issues without evidence.

Return format:
1. Summary
2. Critical issues
3. High issues
4. Medium issues
5. Low issues
6. Suggested fixes
7. Missing tests
8. Missing observability or safeguards

MCP tool usage:
- MUST use Context7 (`mcp_upstash_conte_*`) to verify NestJS, Prisma 7, CASL, or class-validator patterns before flagging potential issues — ensure findings are grounded in current API behavior, not outdated assumptions.
- Use Chrome DevTools (`mcp_io_github_chr_*`) to test the running API if the code under review affects endpoints.