---
name: harness
description: Use when running the delivery pipeline in this repo — sequences the explore→requirements→design→blueprint→breakdown→implement→fix-loop→deliver stages, enforces the two human gates, and the test+review fix-loop.
---

# Harness Operating Loop

Drive work through the pipeline **in order**, one stage per command:

1. `/explore <task>` — understand the codebase/domain; append findings to `docs/run-log.md`. No code.
2. `/requirements` — write `docs/spec.md` (Purpose, Requirements, Acceptance Criteria, Out of Scope). **HUMAN GATE:** stop; ask the user to approve scope before continuing.
3. `/design` — technical design from the spec.
4. `/blueprint` — exact files to create/modify + build sequence.
5. `/breakdown` — write `docs/plan.md` as bite-sized, testable tasks.
6. `/implement` — write code per `docs/plan.md`, checking off tasks.
7. `/fix-loop` — run tests, then the `reviewer` subagent, fixing until tests pass AND review has no blockers (max 5 iterations, then escalate). Append each iteration to `docs/run-log.md`.
8. `/deliver` — package the release. **HUMAN GATE:** stop; ask the user to approve release before finalizing.

## Rules
- Review is always independent — invoke the `reviewer` subagent, never self-review inside `/fix-loop`.
- Do not skip a stage or remove a gate.
- The source of truth is the docs, not the chat: keep `spec.md`, `plan.md`, and `run-log.md` current.
