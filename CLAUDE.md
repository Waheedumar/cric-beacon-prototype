# Cric Beacon – Project Rules

## Context rules (token safety)
- index.html is large (~200 KB). NEVER read it in full.
  Use Read with offset/limit (max 100 lines) only.
- Search with bash grep, always truncated:
  grep -n "pattern" index.html | cut -c1-150 | head -40
- Never search or read .claude/worktrees/, node_modules/, data/.
- Never print .env.local or any API key.

## Workflow
- One task per session. Keep answers short.
- Investigation steps: no code changes unless asked.
- Track current task progress in PROGRESS.md
  (findings, line numbers, next step). Update it at the end of each step.
- Move code only when refactoring; never change logic in the same step.