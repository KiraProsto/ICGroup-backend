Review this feature or implementation from a system-design perspective.

Focus on:
- architecture fit
- scalability
- reliability
- failure modes
- security
- data consistency
- observability
- maintainability
- cost and complexity tradeoffs

Project context:
- Backend: NestJS 11 modular monolith, REST API, ESM-only
- ORM: Prisma 7 with PrismaPg driver adapter, PostgreSQL 16
- Auth: JWT rotation, Argon2id, CASL attribute-level RBAC
- Async: Redis 7, BullMQ (audit queue), @nestjs/throttler
- Storage: MinIO / S3-compatible abstraction
- Rich text: Tiptap/ProseMirror JSON, server-side HTML rendering
- Infra: Docker Compose (dev), single NestJS process with module boundaries

Instructions:
- do not give generic textbook advice
- tailor the review to the attached code or described feature
- identify real bottlenecks, risks, and hidden assumptions
- suggest pragmatic improvements, not idealized rewrites

Return:
1. High-level assessment
2. Main risks
3. Scalability concerns
4. Reliability concerns
5. Security concerns
6. Suggested improvements
7. What is acceptable as-is

MCP tool usage:
- MUST use Context7 (`mcp_upstash_conte_*`) to verify library capabilities (NestJS modules, Prisma 7 features, BullMQ options, CASL patterns) before making design recommendations.
- Use Chrome DevTools (`mcp_io_github_chr_*`) or Playwright (`mcp_mcp_docker_browser_*`) to inspect the running API if verifying current behavior is needed.