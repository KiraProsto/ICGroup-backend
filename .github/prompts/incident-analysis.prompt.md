Analyze this incident, bug, or production failure.

Focus on:
- likely root cause
- contributing factors
- missing safeguards
- missing observability
- whether the issue could recur
- whether the current architecture encourages this failure mode

Instructions:
- Be concrete, not generic.
- Distinguish confirmed evidence from hypothesis.
- Identify the smallest safe fix and the longer-term corrective actions.

Return:
1. Incident summary
2. Most likely root cause
3. Contributing factors
4. Immediate remediation
5. Preventive actions
6. Observability improvements
7. Tests to add

MCP tool usage:
- Use Context7 (`mcp_upstash_conte_*`) to verify expected library behavior if the incident may involve NestJS, Prisma, BullMQ, or Redis misconfiguration.
- Use Chrome DevTools (`mcp_io_github_chr_*`) to inspect the running API (health check, error responses, headers) if the service is accessible.