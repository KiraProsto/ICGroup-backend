Review the webhook handler or integration code.

Focus on:
- signature verification
- replay and duplicate handling
- idempotency
- provider retry behavior
- out-of-order event handling
- safe logging
- timeout behavior
- queue handoff

Instructions:
- Assume the provider can resend events.
- Assume payloads can be partial or stale.
- Report concrete risks, not generic webhook advice.

Return:
1. Summary
2. Reliability risks
3. Security risks
4. Data consistency risks
5. Suggested safer implementation

MCP tool usage:
- Use Context7 (`mcp_upstash_conte_*`) to look up NestJS guard/interceptor patterns and BullMQ queue handoff API when reviewing webhook-to-queue flows.