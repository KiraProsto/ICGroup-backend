---
applyTo: "**/*.{spec,test}.{ts,js}"
---

Testing rules for this NestJS / Prisma 7 / ESM project:

Framework:
- Jest with ESM support (SWC transformer via `@swc/jest`).
- Unit tests: `*.spec.ts` alongside source files in `src/`.
- E2E tests: `test/` directory, separate `jest-e2e.json` config.
- Run: `npm test` (unit), `npm run test:e2e` (e2e), `npm run test:cov` (coverage).

What to test:
- Test behavior, contracts, and failure modes — not implementation details.
- Cover happy path, edge cases, and negative cases.
- For auth/RBAC: include unauthorized, wrong-role, and malformed-input cases.
- For CASL policies: test that each role can and cannot access the expected resources.
- For BullMQ processors: test idempotency (processing same job twice produces same result).
- For Prisma queries: test that soft-deleted records are excluded, pagination works, filters apply.
- Add regression tests for every bug fix.

Mocking patterns:
- Mock `PrismaService` — never connect to a real database in unit tests. Use `jest.fn()` for model methods.
- Mock Redis/BullMQ in unit tests — test queue producers and consumers independently.
- Use `@nestjs/testing` `Test.createTestingModule()` for NestJS integration tests.
- Mock `ConfigService` with known test values — never use real secrets.

E2E tests:
- Use `supertest` against the NestJS app.
- Test full request/response cycles including validation, auth, and error shapes.
- Test that the global `ValidationPipe` rejects unknown fields.

General:
- Prefer deterministic tests — no reliance on timing, external services, or random data.
- Avoid brittle implementation-detail testing unless that detail is the contract.
- Never include real secrets, tokens, or credentials in test fixtures.

MCP tool usage:
- Use Context7 (`mcp_upstash_conte_*`) to look up Jest, @nestjs/testing, and supertest APIs when writing test scaffolds or unfamiliar test patterns.
- For E2E tests: if the app is running locally, use Chrome DevTools (`mcp_io_github_chr_*`) or Playwright (`mcp_mcp_docker_browser_*`) to verify Swagger UI and REST endpoints visually.