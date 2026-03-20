---
applyTo: "**/*redis*.ts,**/*queue*.ts,**/*job*.ts,**/*bull*.ts,**/*throttl*.ts"
---

Redis / BullMQ rules for this project:

Redis usage patterns in this codebase:
- Refresh token allowlist: `rt:{jti}` → userId, with TTL matching token expiry (7d).
- Refresh token family (rotation attack detection): `rt-family:{familyId}:{jti}` → "used".
- CASL ability cache: `ability:{userId}` → serialized ability, TTL 300s.
- Rate limiting: `@nestjs/throttler` with Redis store (5 req/min login, 120 req/min global).
- BullMQ: audit log queue for async operational event processing.
- Redis 7 with AOF persistence is required — token allowlist data must survive restarts.

BullMQ (audit queue):
- Audit job handlers must be idempotent — jobs can be retried, duplicated.
- Security events (login, logout, role changes) are logged synchronously, NOT via BullMQ.
- Operational events (CRUD on content, companies, purchases) go through the BullMQ audit queue.
- Be explicit about attempts, backoff, timeouts, removeOnComplete, removeOnFail.
- Include enough context in job data (actorId, action, resourceType, resourceId) for debugging, but never include secrets, password hashes, or tokens.
- Consider dead-letter or manual inspection for repeated failures.

Redis general:
- Be careful with TTL semantics and stale cache — especially for CASL ability cache invalidation on role changes.
- Never assume Redis is a source of truth for business data — it's a cache and token store.
- On token family reuse detection: delete ALL keys in the family to revoke the entire session.

Observability:
- Log job IDs, entity IDs, and retry counts where useful.
- Call out missing alerting on queue backlog or failure rates.

MCP tool usage:
- MUST use Context7 (`mcp_upstash_conte_*`) to look up BullMQ and ioredis documentation before configuring queue options (attempts, backoff, concurrency, rate limiting) or writing Redis commands.
- For @nestjs/throttler configuration, verify options against Context7 docs.