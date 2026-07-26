# Claude Harness Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained, model-agnostic "harness" — a set of native Claude Code slash commands, a reviewer subagent, and a skill — that runs an 8-stage delivery pipeline with a test+review fix-loop.

**Architecture:** Each pipeline stage is a markdown slash command under `.claude/commands/`. Independent review runs in a separate context via a `.claude/agents/reviewer.md` subagent, invoked standalone and from inside `/fix-loop`. State flows through source-of-truth docs (`docs/spec.md`, `docs/plan.md`, `docs/run-log.md`). A `.claude/skills/harness/SKILL.md` documents the operating loop.

**Tech Stack:** Markdown (Claude Code custom slash commands, subagents, skills). No runtime code, no third-party framework. Target model: Claude Sonnet (not pinned).

## Global Constraints

- Deliverables are **markdown prompt templates**, not runtime code — "tests" are structural checks + one end-to-end dry run (Task 7).
- Slash command files live at `.claude/commands/<name>.md`; the command name is the filename. Each needs a YAML frontmatter `description:`.
- Subagent file `.claude/agents/reviewer.md` needs frontmatter `name:` and `description:` (and `tools:` restricting it to read-only + test execution).
- Skill file `.claude/skills/harness/SKILL.md` needs frontmatter `name:` and `description:`.
- Fix-loop iteration cap = **5**, then escalate to human.
- Two human gates: after `/requirements`, before `/deliver`.
- Jira / story-delivery: **out of scope** for v1.
- Commit with sign-off (`git commit -s`). End commit bodies with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

## File Structure

| File | Responsibility |
|---|---|
| `.gitignore` | ignore OS/editor cruft and run artifacts |
| `README.md` | human entry point: what it is, how to run the pipeline |
| `CLAUDE.md` | project memory: the operating model for any agent session |
| `docs/spec.md` | template: scope + acceptance criteria (source of truth) |
| `docs/plan.md` | template: task breakdown |
| `.claude/skills/harness/SKILL.md` | the operating loop, loaded automatically |
| `.claude/agents/reviewer.md` | independent reviewer subagent |
| `.claude/commands/explore.md` | stage 1: understand codebase/domain |
| `.claude/commands/requirements.md` | stage 2: write `spec.md` → human gate |
| `.claude/commands/design.md` | stage 3: technical design |
| `.claude/commands/blueprint.md` | stage 4: files to touch + build sequence |
| `.claude/commands/breakdown.md` | stage 5: write `plan.md` |
| `.claude/commands/implement.md` | stage 6: write code per plan |
| `.claude/commands/fix-loop.md` | stage 7: test + review until green |
| `.claude/commands/deliver.md` | stage 8: release → human gate |

---

## Task 1: Repo scaffold + doc templates

**Files:**
- Create: `.gitignore`, `README.md`, `CLAUDE.md`, `docs/spec.md`, `docs/plan.md`

**Interfaces:**
- Produces: source-of-truth doc templates (`docs/spec.md`, `docs/plan.md`) that later commands read/write; `CLAUDE.md` describing the pipeline every command relies on.

- [ ] **Step 1: Create `.gitignore`**

```gitignore
.DS_Store
Thumbs.db
*.log
docs/run-log.md
.idea/
.vscode/
node_modules/
```

- [ ] **Step 2: Create `docs/spec.md` template**

```markdown
# Spec: <task title>

## Purpose
<one paragraph: what and why>

## Requirements
- <requirement>

## Acceptance Criteria
- [ ] <verifiable criterion the fix-loop reviewer checks against>

## Out of Scope
- <explicitly excluded>
```

- [ ] **Step 3: Create `docs/plan.md` template**

```markdown
# Plan: <task title>

Derived from `docs/spec.md`. Each task ends with a testable deliverable.

## Tasks
- [ ] Task 1: <name> — <files> — <test>
```

- [ ] **Step 4: Create `CLAUDE.md`**

```markdown
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
```

- [ ] **Step 5: Create `README.md`**

```markdown
# Claude Harness

A model-agnostic delivery harness built from native Claude Code primitives
(slash commands, a reviewer subagent, a skill). It runs an 8-stage pipeline
with a test+review fix-loop. Runs on Claude Sonnet.

## Usage
Run the stages in order in a Claude Code session:

    /explore <task>
    /requirements
    /design
    /blueprint
    /breakdown
    /implement
    /fix-loop
    /deliver

`/requirements` pauses for you to approve scope; `/deliver` pauses for you to
approve release. `/fix-loop` runs tests and an independent review, fixing and
re-running until green (max 5 iterations).

## Portability
Copy the `.claude/` directory into any repo to run the harness there.

See `docs/superpowers/specs/` for the design and `CLAUDE.md` for the operating model.
```

- [ ] **Step 6: Verify structure**

Run: `ls docs && head -3 CLAUDE.md`
Expected: `plan.md spec.md superpowers` listed; `CLAUDE.md` starts with `# Claude Harness — Operating Model`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore README.md CLAUDE.md docs/spec.md docs/plan.md
git commit -s -m "Scaffold harness repo: docs templates, CLAUDE.md, README"
```

---

## Task 2: Harness skill

**Files:**
- Create: `.claude/skills/harness/SKILL.md`

**Interfaces:**
- Produces: auto-loaded operating-loop guidance referencing the stage commands and gates.

- [ ] **Step 1: Create `.claude/skills/harness/SKILL.md`**

```markdown
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
```

- [ ] **Step 2: Verify frontmatter**

Run: `head -4 .claude/skills/harness/SKILL.md`
Expected: contains `name: harness` and a `description:` line.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/harness/SKILL.md
git commit -s -m "Add harness skill documenting the operating loop"
```

---

## Task 3: Reviewer subagent

**Files:**
- Create: `.claude/agents/reviewer.md`

**Interfaces:**
- Consumes: `docs/spec.md` acceptance criteria + the working-tree diff.
- Produces: a verdict line `REVIEW: PASS` or `REVIEW: BLOCK` plus a findings list. `/fix-loop` (Task 5) keys off this exact verdict string.

- [ ] **Step 1: Create `.claude/agents/reviewer.md`**

```markdown
---
name: reviewer
description: Independent code reviewer. Use to review a change against docs/spec.md acceptance criteria in a context separate from implementation. Invoked standalone or from /fix-loop.
tools: Read, Grep, Glob, Bash
---

You are an independent reviewer. You did NOT write this code. Judge it against
`docs/spec.md` — nothing else.

## Do
1. Read `docs/spec.md` Acceptance Criteria.
2. Inspect the change: `git diff` (and `git diff --staged`).
3. Check each acceptance criterion: met or not.
4. Look for correctness bugs, missing tests, and spec deviations.

## Output (exactly this shape)
- A short findings list, each tagged `[BLOCKER]` or `[minor]`.
- A final line that is EXACTLY one of:
  - `REVIEW: PASS`  (no blockers, all acceptance criteria met)
  - `REVIEW: BLOCK` (one or more `[BLOCKER]` findings)

Be strict: anything that fails an acceptance criterion or is a correctness bug
is a `[BLOCKER]`. Style nits are `[minor]` and do not block.
```

- [ ] **Step 2: Verify frontmatter + verdict contract**

Run: `grep -E "name: reviewer|REVIEW: (PASS|BLOCK)" .claude/agents/reviewer.md`
Expected: matches `name: reviewer`, `REVIEW: PASS`, and `REVIEW: BLOCK`.

- [ ] **Step 3: Commit**

```bash
git add .claude/agents/reviewer.md
git commit -s -m "Add independent reviewer subagent with PASS/BLOCK verdict"
```

---

## Task 4: Planning-phase commands

**Files:**
- Create: `.claude/commands/explore.md`, `requirements.md`, `design.md`, `blueprint.md`, `breakdown.md`

**Interfaces:**
- Consumes: `$ARGUMENTS` (the task text) in `/explore`; `docs/spec.md` in later stages.
- Produces: `docs/spec.md` (from `/requirements`), `docs/plan.md` (from `/breakdown`).

- [ ] **Step 1: Create `.claude/commands/explore.md`**

```markdown
---
description: Stage 1 — explore the codebase/domain for a task. No code changes.
argument-hint: <task description>
---

Task: $ARGUMENTS

Explore this repository to understand what the task touches. Read relevant files,
map the structure, note existing patterns, conventions, and constraints.

Do NOT write or change code. Append a "## Explore: <task>" section to
`docs/run-log.md` with: affected areas, relevant files, patterns to follow, risks,
and open questions. End by suggesting the user run `/requirements`.
```

- [ ] **Step 2: Create `.claude/commands/requirements.md`**

```markdown
---
description: Stage 2 — capture requirements into docs/spec.md, then stop at the scope gate.
---

Using the exploration notes in `docs/run-log.md`, write `docs/spec.md` with:
Purpose, Requirements, Acceptance Criteria (verifiable checkboxes the reviewer
will test against), and Out of Scope.

Keep acceptance criteria concrete and testable.

**HUMAN GATE:** After writing `docs/spec.md`, STOP. Summarize the scope and ask
the user to approve it before any design work. Do not proceed to `/design`
yourself.
```

- [ ] **Step 3: Create `.claude/commands/design.md`**

```markdown
---
description: Stage 3 — produce a technical design from the approved spec.
---

Read `docs/spec.md`. Produce a technical design: chosen approach, key components
and their responsibilities, data flow, and notable trade-offs or alternatives
rejected. Keep it proportional to the task.

Append a "## Design" section to `docs/run-log.md`. End by suggesting `/blueprint`.
```

- [ ] **Step 4: Create `.claude/commands/blueprint.md`**

```markdown
---
description: Stage 4 — turn the design into an implementation blueprint.
---

From the design in `docs/run-log.md` and `docs/spec.md`, produce an implementation
blueprint: the exact files to create or modify (with one-line responsibility each)
and the build sequence (what order to implement in, and where tests go).

Append a "## Blueprint" section to `docs/run-log.md`. End by suggesting `/breakdown`.
```

- [ ] **Step 5: Create `.claude/commands/breakdown.md`**

```markdown
---
description: Stage 5 — break the blueprint into bite-sized tasks in docs/plan.md.
---

From the blueprint, write `docs/plan.md` as bite-sized, independently testable
tasks (checkbox list). Each task names its files and how it is tested. Fold setup
into the task that needs it. (Jira/story export is out of scope.)

End by suggesting `/implement`.
```

- [ ] **Step 6: Verify all five commands have a description**

Run: `grep -L "description:" .claude/commands/explore.md .claude/commands/requirements.md .claude/commands/design.md .claude/commands/blueprint.md .claude/commands/breakdown.md`
Expected: no output (every file contains `description:`).

- [ ] **Step 7: Commit**

```bash
git add .claude/commands/explore.md .claude/commands/requirements.md .claude/commands/design.md .claude/commands/blueprint.md .claude/commands/breakdown.md
git commit -s -m "Add planning-phase commands: explore, requirements, design, blueprint, breakdown"
```

---

## Task 5: Implementation + fix-loop commands

**Files:**
- Create: `.claude/commands/implement.md`, `.claude/commands/fix-loop.md`

**Interfaces:**
- Consumes: `docs/plan.md` (in `/implement`); the `reviewer` subagent's `REVIEW: PASS`/`REVIEW: BLOCK` verdict (in `/fix-loop`).
- Produces: code changes; appended iteration records in `docs/run-log.md`.

- [ ] **Step 1: Create `.claude/commands/implement.md`**

```markdown
---
description: Stage 6 — implement the code per docs/plan.md.
---

Work through `docs/plan.md` task by task. Write the code (and tests where the plan
calls for them), checking off tasks as you complete them. Follow the repo's existing
patterns and conventions.

Do not run the full review here — that is `/fix-loop`'s job. End by suggesting
`/fix-loop`.
```

- [ ] **Step 2: Create `.claude/commands/fix-loop.md`**

```markdown
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
```

- [ ] **Step 3: Verify the fix-loop encodes the cap and both-green exit**

Run: `grep -E "cap is 5|REVIEW: PASS|reviewer subagent" .claude/commands/fix-loop.md`
Expected: matches the cap, the PASS verdict, and the reviewer-subagent invocation.

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/implement.md .claude/commands/fix-loop.md
git commit -s -m "Add implement and fix-loop commands (test+review, cap 5)"
```

---

## Task 6: Delivery command

**Files:**
- Create: `.claude/commands/deliver.md`

**Interfaces:**
- Consumes: a green fix-loop result.
- Produces: release actions (branch/commit/PR or build) gated on human approval.

- [ ] **Step 1: Create `.claude/commands/deliver.md`**

```markdown
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
```

- [ ] **Step 2: Verify the human gate is present**

Run: `grep -E "HUMAN GATE|approve the release" .claude/commands/deliver.md`
Expected: both matches present.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/deliver.md
git commit -s -m "Add deliver command with release human gate"
```

---

## Task 7: End-to-end dry run (validation)

**Files:**
- Temporary: a throwaway sample under `sample/` (deleted at the end).

**Interfaces:**
- Consumes: all commands, the reviewer subagent, the skill.
- Produces: evidence in `docs/run-log.md` that the pipeline and fix-loop behave.

- [ ] **Step 1: Confirm commands and subagent are registered**

Run: `ls .claude/commands && ls .claude/agents && ls .claude/skills/harness`
Expected: 8 command files, `reviewer.md`, `SKILL.md`.

- [ ] **Step 2: Seed a deliberately-failing sample**

Create `sample/add.js` with a wrong implementation and `sample/add.test.js`:

```javascript
// sample/add.js
function add(a, b) { return a - b; }   // intentionally wrong
module.exports = { add };
```
```javascript
// sample/add.test.js
const { add } = require('./add');
if (add(2, 3) !== 5) { console.error('FAIL: add(2,3) !== 5'); process.exit(1); }
console.log('PASS');
```

- [ ] **Step 3: Write a minimal spec for the sample**

Set `docs/spec.md` Acceptance Criteria to: `- [ ] add(a,b) returns a+b; node sample/add.test.js prints PASS`.

- [ ] **Step 4: Dry-run the fix-loop manually**

Run: `node sample/add.test.js`
Expected: FAIL (exit 1) — this is what `/fix-loop` iteration 1 must detect.

Then apply the fix (`return a + b;`) and re-run:
Run: `node sample/add.test.js`
Expected: `PASS` — the both-green exit condition.

- [ ] **Step 5: Confirm the loop logic against the run**

Verify by reading `.claude/commands/fix-loop.md` that: a FAIL on step 1 forces another iteration, and only test-pass + `REVIEW: PASS` exits green. Note the confirmation in `docs/run-log.md`.

- [ ] **Step 6: Remove the sample**

```bash
rm -rf sample
```

- [ ] **Step 7: Commit the validation note**

```bash
git add docs/run-log.md
git commit -s -m "Validate pipeline structure and fix-loop dry run"
```

---

## Self-Review

**1. Spec coverage:**
- Approach B (custom commands) → Tasks 2–6. ✓
- 8 stages → Task 4 (5 planning) + Task 5 (implement, fix-loop) + Task 6 (deliver). ✓
- Independent review subagent → Task 3, invoked by `/fix-loop` in Task 5. ✓
- Fix-loop test+review, cap 5, both-green exit, evidence → Task 5 Step 2. ✓
- Two human gates (after requirements, before deliver) → Task 4 Step 2, Task 6 Step 1. ✓
- Source-of-truth docs → Task 1. ✓
- Skill / operating loop → Task 2. ✓
- Portability (copy `.claude/`) → documented in `CLAUDE.md`/`README.md` (Task 1). ✓
- Jira deferred → stated as out of scope in `/breakdown` (Task 4 Step 5). ✓
- Validation dry run → Task 7. ✓

**2. Placeholder scan:** No "TBD"/"add appropriate X"; every file's full content is inlined. ✓

**3. Type consistency:** The reviewer's verdict strings `REVIEW: PASS` / `REVIEW: BLOCK` are defined in Task 3 and consumed verbatim in Task 5's `/fix-loop`. ✓
