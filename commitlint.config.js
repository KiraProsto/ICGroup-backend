// commitlint.config.js
// Enforces Conventional Commits: https://www.conventionalcommits.org
// Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Increase subject length limit from default 72 to 100 to match printWidth
    'header-max-length': [2, 'always', 100],
    // Enforce lowercase type (feat, fix …) — already default, explicit for clarity
    'type-case': [2, 'always', 'lower-case'],
    // Body and footer lines may be long (URLs, stack traces)
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
