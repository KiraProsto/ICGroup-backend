---
applyTo: "**/*.{ps1,psm1,psd1}"
---

PowerShell scripting rules:

General:
- Write scripts for safety, clarity, and repeatability.
- Prefer explicit parameters over interactive prompts.
- Use advanced functions with parameter validation when appropriate.
- Prefer idempotent behavior — scripts should be safe to run more than once.

Safety:
- Treat file operations, service changes, and Docker operations as potentially destructive.
- Add safeguards for destructive operations: -WhatIf, -Confirm, explicit environment targeting.
- Never default to deleting, overwriting, or force-applying without clear intent.
- Do not use `Invoke-Expression` unless absolutely necessary — call out the risk.
- Avoid shelling out when native PowerShell cmdlets are available.

Error handling:
- Use `$ErrorActionPreference = 'Stop'` in non-trivial scripts.
- Prefer `try/catch/finally` around critical operations.
- Return actionable error messages without leaking secrets.

Input validation:
- Validate all parameters: paths, environment names, identifiers.
- Avoid trusting raw user input for command execution or file paths.

Output:
- Prefer structured objects over plain text when output is intended for automation.
- Use `Write-Verbose`, `Write-Warning`, and `Write-Error` appropriately.
- Never print secrets, tokens, access keys, or database connection strings.

Project context:
- Local dev uses Docker Compose (postgres, redis, minio, app).
- Common scripted tasks: Docker Compose management, database seeding, migration running, environment setup.
- Build: `npm run build` (SWC), `npm run prisma:generate`, `npm run prisma:migrate`.