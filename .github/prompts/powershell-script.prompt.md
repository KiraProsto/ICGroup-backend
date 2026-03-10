Create or review a PowerShell script for production-safe usage.

Requirements:
- validate all inputs
- fail safely
- avoid secret exposure
- support safe execution patterns where relevant
- prefer idempotent behavior
- include clear logging
- avoid unsafe shell evaluation
- add -WhatIf / -Confirm semantics for destructive operations where practical

When relevant, also consider:
- Docker Compose service targeting (postgres, redis, minio, app)
- rollback implications
- accidental production impact
- file deletion / overwrite risk
- permission requirements

Return:
1. Script purpose
2. Main risks
3. Safe implementation
4. Usage examples
5. Notes on destructive safeguards