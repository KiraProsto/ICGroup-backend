---
applyTo: "**/*webhook*.ts,**/*hook*.ts"
---

Webhook handling rules (for when webhook endpoints are added):

Security:
- Verify webhook signatures when the provider supports it.
- Validate payload shape and event type — reject malformed or unsigned requests.
- Never trust source IP alone as authentication.

Reliability:
- Assume duplicate delivery and out-of-order delivery.
- Make handlers idempotent — processing the same event twice must be safe.
- Acknowledge quickly (return 2xx), move slow work to BullMQ jobs.

Data handling:
- Do not trust webhook payloads as canonical — re-fetch from provider if needed.
- Log correlation IDs and external event IDs, but not secrets.