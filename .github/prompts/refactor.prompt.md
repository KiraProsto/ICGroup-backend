Refactor the attached code carefully.

Goals:
- preserve behavior
- improve readability
- improve maintainability
- improve type safety
- reduce duplication
- reduce nesting
- make the code easier to test

Constraints:
- do not change public API unless necessary
- do not introduce unnecessary abstractions
- avoid overengineering
- keep the diff as small as practical
- preserve existing comments unless they are misleading
- keep security and observability intact or improve them

Before writing the final code:
- identify the main refactoring targets
- explain the planned approach briefly
- call out any risk of behavioral change

Return:
1. Refactoring plan
2. Updated code
3. Key improvements made
4. Any remaining risks or tradeoffs

MCP tool usage:
- Use Context7 (`mcp_upstash_conte_*`) to look up idiomatic NestJS, Prisma 7, or CASL patterns before refactoring — ensure the new structure follows current best practices.