---
description: Stage 8 — package the release, gated on human approval.
---

Confirm `/fix-loop` ended green (tests pass and `REVIEW: PASS` in `docs/run-log.md`).
If not, stop and tell the user to run `/fix-loop` first.

Prepare the release: ensure changes are committed on a feature branch with a clear
message, summarize what shipped against `docs/spec.md` acceptance criteria, and draft
the PR title/body (do not open external PRs without asking).

**HUMAN GATE:** STOP and ask the user to approve the release before pushing or
opening a PR. Do not finalize on your own.
