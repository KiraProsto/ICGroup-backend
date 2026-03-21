---
applyTo: "**/*"
---

Git branching and merge rules — STRICTLY ENFORCED:

Protected branches:
- `main` and `dev` are protected branches.
- NEVER push commits directly to `main` or `dev` — no exceptions.
- ALL changes to `main` and `dev` MUST go through a Pull Request (Merge Request).
- This applies to every kind of change: features, bug fixes, hotfixes, config changes, CI/CD fixes, typo fixes — everything.

Workflow:
- `dev` is the integration branch. `main` is the production branch.
- Create a feature/fix branch from `dev` (e.g., `feature/add-auth`, `fix/swagger-env`).
- Commit and push to the feature branch.
- Open a Pull Request targeting `dev`.
- The PR must be reviewed and approved before merging into `dev`.
- To release to production: open a PR from `dev` to `main`. Never merge feature branches directly into `main`.
- Never use `git push --force` on protected branches.

What this means for the AI agent:
- When asked to push changes, ALWAYS push to a feature branch — never to `main` or `dev`.
- Feature branches MUST be created from `dev`, not from `main`.
- Pull Requests MUST target `dev`. Never create a PR targeting `main` unless it is a `dev → main` release PR.
- When using GitHub API tools (e.g., `mcp_io_github_git_push_files`, `mcp_io_github_git_create_or_update_file`), target the current working branch or create a new branch from `dev` — NEVER target `main` or `dev` directly.
- After pushing to a feature branch, create a Pull Request targeting `dev` via `mcp_io_github_git_create_pull_request`.
- If the user explicitly asks to push directly to `main` or `dev`, refuse and explain the rule. Suggest creating a PR instead.
- If the user asks to create a PR to `main`, confirm whether they mean a release PR from `dev → main`. Feature/fix PRs always go to `dev`.

Naming conventions:
- Feature branches: `feature/<short-description>`
- Bug fix branches: `fix/<short-description>`
- Hotfix branches: `hotfix/<short-description>`
- Chore/config branches: `chore/<short-description>`
