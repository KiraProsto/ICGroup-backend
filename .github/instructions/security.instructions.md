---
applyTo: "**/*"
---

Security rules apply to all files.

General:
- Treat every boundary as hostile: HTTP requests, headers, cookies, query params, file uploads, env vars, and database values.
- Default to least privilege and explicit allowlists.
- Never trust client-provided identifiers, roles, permissions, prices, or ownership markers.
- Never bypass server-side validation because the admin frontend already validates.

Project-specific security patterns:
- Auth: JWT access (15min) + refresh (7d) with rotation — refresh token in HttpOnly SameSite=Strict cookie.
- Token management: refresh token allowlist in Redis, family rotation for reuse detection.
- Password hashing: Argon2id — never bcrypt, never plaintext comparison.
- RBAC: CASL attribute-level policies — enforce via PoliciesGuard, not ad-hoc role checks.
- Input validation: global ValidationPipe with `forbidNonWhitelisted: true` — rejects unknown fields.
- Rich text: ProseMirror JSON stored in DB, server-side HTML rendering — XSS-safe by design. Never store or render raw user HTML.
- File uploads: validate MIME type, file size, and dimensions server-side before storing to MinIO/S3.
- Audit trail: every mutation logged — secrets and password hashes stripped from before/after snapshots.

Secrets:
- Never hardcode credentials, tokens, API keys, connection strings, or certificates.
- Never place secrets in test fixtures, examples, comments, docs, or logs.
- All secrets via environment variables, validated at startup via Joi.

Authentication and authorization:
- Check both authentication and authorization on every request.
- Do not assume authenticated means authorized — CASL policies must pass.
- Enforce resource ownership (createdById) where applicable.
- Roles: SUPER_ADMIN, CONTENT_MANAGER, SALES_MANAGER — enforce attribute-level, not just route-level.

Input handling:
- Validate shape, type, size, and allowed values in DTOs.
- Reject unexpected fields (enforced by ValidationPipe whitelist mode).
- Be careful with object spread from untrusted data — mass assignment risk.
- Parameterize all Prisma raw queries.

Common risks to check:
- SQL injection (via raw queries)
- path traversal (file upload paths)
- SSRF (if external URLs are fetched)
- XSS (if HTML rendering bypasses ProseMirror pipeline)
- insecure file upload handling (type, size, storage path)
- prototype pollution (object spread from request body)
- broken access control (missing CASL checks)
- mass assignment (spreading request body into Prisma .create/.update)
- race conditions in publish/archive and role-change flows

Logging and errors:
- Never log secrets, auth headers, cookies, PII, password hashes, or JWT tokens.
- Redact sensitive identifiers in audit snapshots.
- Error messages to clients must not leak internal implementation details.

Review behavior:
- When reviewing code, actively look for security bugs even if the task is not security-related.
- If a solution is functionally correct but insecure, reject it and propose a safer approach.

MCP tool usage:
- MUST use Context7 (`mcp_upstash_conte_*`) to verify security library APIs (Helmet, Passport, Argon2, CASL, @nestjs/throttler) before configuring or reviewing security-critical code.
- When reviewing auth flows or RBAC policies, query Context7 for the latest CASL and @nestjs/passport patterns to ensure correctness.