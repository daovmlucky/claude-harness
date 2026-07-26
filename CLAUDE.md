# Claude Harness — Operating Model

This repo's `.claude/` directory is a **delivery harness**: disciplined slash
commands that take a task from idea to release. Copy `.claude/` into any target
repo to use it there.

## Pipeline (run in order)
`/explore` → `/requirements` → `/design` → `/blueprint` → `/breakdown` →
`/implement` → `/fix-loop` → `/deliver`

## Source-of-truth files
- `docs/spec.md` — scope + acceptance criteria (written by `/requirements`)
- `docs/plan.md` — task breakdown (written by `/breakdown`)
- `docs/run-log.md` — appended evidence for each run and each fix-loop iteration

## Discipline rules
- Review is **independent** of implementation — it runs in the `reviewer` subagent.
- Two human gates: after `/requirements` (approve scope) and before `/deliver`
  (approve release). Stop and wait for the human at each.
- `/fix-loop` iterates test → review at most **5** times, then escalates.
- Never edit a gate away or skip the fix-loop.
