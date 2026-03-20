Investigate and fix the bug in the attached code.

Work systematically:
- identify the likely root cause
- list alternative hypotheses if the cause is not obvious
- verify assumptions from the code
- propose the smallest safe fix first
- mention edge cases and regression risks

Constraints:
- preserve existing behavior outside the bug scope
- do not rewrite unrelated code
- do not hide the bug with a workaround unless explicitly necessary
- update related validation, types, and tests if needed
- preserve logging, tracing, and security guarantees

Return:
1. Root cause
2. Why it happens
3. Fix strategy
4. Updated code
5. Regression tests to add

MCP tool usage:
- Use Context7 (`mcp_upstash_conte_*`) to verify library behavior if the bug may stem from incorrect API usage (NestJS, Prisma 7, CASL, BullMQ).
- Use Chrome DevTools (`mcp_io_github_chr_*`) to reproduce and verify the fix against the running API if applicable.