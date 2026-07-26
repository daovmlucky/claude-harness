# Claude Harness Pipeline — Design Spec

**Date:** 2026-07-26
**Status:** Approved (design) — pending implementation plan
**Owner:** Dao Vu

## 1. Purpose

A disciplined, model-agnostic delivery pipeline for AI coding agents, built entirely
from **native Claude Code primitives** (slash commands, subagents, skills). It mirrors
an existing 10-stage "dynamic workflow" pipeline but restructures it as a maintainable,
in-repo **harness** and adds an enhanced **fix-loop that folds in test + review**.

It runs on **Claude Sonnet** (model-agnostic — nothing is pinned to a specific model).

## 2. Goals & non-goals

**Goals**
- Reproduce the pipeline shape: `explore → requirements → design → blueprint →
  breakdown → implementation → fix-loop → delivery`.
- Enforce harness discipline: plan before work, review **independent** of
  implementation, source-of-truth docs, evidence retention, human gates at the edges.
- Add a fix-loop that iterates **test + review until green**, with a safety cap.
- Be self-contained (no third-party framework dependency) and **portable** — the
  `.claude/` directory can be copied into any target repo.

**Non-goals (v1)**
- No Jira / Atlassian integration (the `breakdown → Jira stories` branch and the
  standalone `story-delivery` stage are **deferred**).
- Not adopting the third-party `claude-code-harness` framework — we borrow its
  *patterns*, not its code (it is a fixed 5-verb surface that cannot express this
  10-stage shape without fighting its design).
- No container/orchestration infrastructure — this is an in-session discipline layer,
  not an execution platform (that would be ChorusKube's role).

## 3. Approach decision

**Chosen: Approach B — build a custom harness-style command set** that keeps the
10-stage shape, rather than **Approach A** (adopt the real 5-verb `claude-code-harness`
and collapse the stages into it).

Rationale:
- The key requirement (fix-loop with test + review) is **not** a stock harness feature,
  so either approach requires customization — better to customize what we own.
- Preserves the existing, deliberately granular pipeline shape.
- Uses natively-supported Claude Code primitives, so it is not "hacky."
- Avoids coupling core delivery process to a small third-party repo.

Trade-off accepted: **we own the maintenance** (no free upstream upgrades). Mitigated by
borrowing the harness's proven discipline patterns rather than inventing them.

## 4. Building blocks

| Concern | Primitive | Location |
|---|---|---|
| Each pipeline stage | Custom slash command (markdown prompt template) | `.claude/commands/<stage>.md` |
| Independent review | Subagent (separate context from implementation) | `.claude/agents/reviewer.md` |
| Operating-loop guidance | Skill | `.claude/skills/harness/SKILL.md` |
| Scope + acceptance criteria | Source-of-truth doc | `docs/spec.md` (template) |
| Task breakdown | Source-of-truth doc | `docs/plan.md` (template) |
| Run evidence / iteration log | Appended log | `docs/run-log.md` (created per run) |

## 5. Stage definitions

| Stage | Command | Reads | Writes | Notes |
|---|---|---|---|---|
| explore | `/explore` | codebase | notes in run-log | understand codebase/domain |
| requirements | `/requirements` | explore notes | `spec.md` | **human gate: approve scope** |
| design | `/design` | `spec.md` | design section | technical design |
| blueprint | `/blueprint` | design | blueprint section | files to touch + build sequence |
| breakdown | `/breakdown` | blueprint | `plan.md` | task list (Jira export deferred) |
| implementation | `/implement` | `plan.md` | code | write the code per plan |
| fix-loop | `/fix-loop` | diff, `spec.md` | code, run-log | **test + review until green** (see §6) |
| delivery | `/deliver` | green build | release artifacts | **human gate: approve release** |

The `reviewer` subagent is also usable **standalone** (ad-hoc review outside the loop).

## 6. The fix-loop (core enhancement)

`/fix-loop` runs bounded iterations:

1. **Test** — run the target project's test command.
2. **Review** — invoke the `reviewer` subagent to inspect the current diff against
   `spec.md` acceptance criteria, in an **independent context**.
3. **Decide** — if tests fail **OR** review returns blocking findings → apply targeted
   fixes, then go to step 1.
4. **Exit** — when tests pass **AND** review has no blocking findings.
5. **Safety cap** — maximum **5** iterations; on exhaustion, stop and escalate to the
   human with a summary of remaining failures (prevents infinite loops).
6. **Evidence** — every iteration appends outcome (test result, review verdict, fixes
   applied) to `docs/run-log.md`.

Review inside the loop is **automated** (subagent), so the loop can iterate without
blocking on a human; the human gates sit at the pipeline edges (§7).

## 7. Human gates

Two gates; everything between them runs autonomously with the fix-loop self-correcting:
- **After `requirements`** — approve scope/acceptance criteria before design work.
- **Before `deliver`** — approve release after the fix-loop is green.

## 8. Project structure

```
claude-harness/
├── .claude/
│   ├── commands/
│   │   ├── explore.md
│   │   ├── requirements.md
│   │   ├── design.md
│   │   ├── blueprint.md
│   │   ├── breakdown.md
│   │   ├── implement.md
│   │   ├── fix-loop.md
│   │   └── deliver.md
│   ├── agents/
│   │   └── reviewer.md
│   └── skills/
│       └── harness/SKILL.md
├── CLAUDE.md          # how the harness works + conventions
├── README.md          # what it is, how to run the pipeline
├── docs/
│   ├── spec.md        # template (source of truth)
│   └── plan.md        # template
└── .gitignore
```

## 9. Validation

Because the deliverables are prompt-template definitions, validation is a **dry run**:
drive a small sample task (e.g. "add a trivial function + test") through
`/explore → … → /deliver` and confirm the fix-loop correctly iterates on a deliberately
failing test and exits green. Confirm each command loads in Claude Code and the
`reviewer` subagent is invoked from within `/fix-loop`.

## 10. Open decisions (defaulted; adjustable)

- Git: initialize with commit sign-off (`-s`). **Default: yes.**
- Fix-loop cap: **5** iterations.
- Jira/story-delivery: **deferred to a later version.**
