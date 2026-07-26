# Harness Validation — Dry Run

**Date:** 2026-07-26
**Branch:** build-harness

## Registration check
- `.claude/commands/`: 8 stage commands (explore, requirements, design, blueprint,
  breakdown, implement, fix-loop, deliver)
- `.claude/agents/reviewer.md`: present
- `.claude/skills/harness/SKILL.md`: present

## Fix-loop dry run
A throwaway `sample/` with a deliberately wrong `add(a,b) = a - b` and a test asserting
`add(2,3) === 5`:

| Iteration | Action | Test result | Loop decision |
|---|---|---|---|
| 1 | run test on wrong impl | `FAIL: add(2,3) !== 5` (exit 1) | not green → iterate |
| 2 | fix to `a + b`, re-run | `PASS` (exit 0) | tests pass → (with `REVIEW: PASS`) green → `/deliver` |

Confirms `/fix-loop`'s contract: a failing test forces another iteration; the loop only
exits green when tests pass **and** the reviewer returns `REVIEW: PASS`. The `sample/`
scaffold was removed after validation.
