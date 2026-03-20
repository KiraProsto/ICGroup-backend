Review the attached code from a security and production-safety perspective.

Focus on:
- auth and authorization
- secret handling
- unsafe input handling
- injection risks
- XSS / CSRF / SSRF / path traversal / command execution risks
- tenant isolation
- logging leaks
- cloud and infrastructure misconfiguration risks
- destructive-operation safeguards

Instructions:
- Do not give generic security advice.
- Only report issues grounded in the provided code or architecture.
- Prioritize by severity: Critical, High, Medium, Low.
- For each finding, explain:
  1. what is wrong
  2. why it matters
  3. likely impact
  4. safest fix

Return:
1. Summary
2. Critical findings
3. High findings
4. Medium findings
5. Low findings
6. Safer implementation suggestions

MCP tool usage:
- MUST use Context7 (`mcp_upstash_conte_*`) to verify security library APIs (Helmet, Passport, Argon2, CASL, @nestjs/throttler) before recommending configuration changes.
- Use Chrome DevTools (`mcp_io_github_chr_*`) to inspect response headers, CORS behavior, and rate limiting on the running API if available.