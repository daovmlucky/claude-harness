---
description: Stage 7 — iterate test + independent review until green (max 5 iterations).
---

Run a bounded fix-loop. Iteration counter starts at 1; hard cap is 5.

Each iteration:
1. **Test** — run the project's test command (detect it: e.g. `npm test`,
   `go test ./...`, `pytest`, `./gradlew test`). Capture pass/fail.
2. **Review** — invoke the `reviewer` subagent to review the current change
   against `docs/spec.md`. Read its final verdict line (`REVIEW: PASS` or
   `REVIEW: BLOCK`).
3. **Record** — append to `docs/run-log.md`: iteration number, test result,
   review verdict, and any `[BLOCKER]` findings.
4. **Decide**
   - If tests PASS **and** verdict is `REVIEW: PASS` → the loop is **green**; stop
     and report success. Suggest `/deliver`.
   - Otherwise → apply targeted fixes for the failing tests and `[BLOCKER]`
     findings, increment the counter, and repeat from step 1.
5. **Cap** — if the counter would exceed 5, STOP. Do not continue. Summarize the
   remaining failures/blockers in `docs/run-log.md` and escalate to the human.

Never mark the loop green unless BOTH tests pass and review is `REVIEW: PASS`.
