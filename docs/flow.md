# /flow — the generic delivery flow

`/flow` runs the harness pipeline (explore, requirements, design, blueprint, breakdown,
implement, fix-loop, deliver) as one background workflow and stops at the next human
gate. The content of every step is read from `.claude/commands/<step>.md`, so the manual
commands and `/flow` always agree.

## Commands
- `/flow <description>` starts a task and runs to the first gate (after `requirements`).
- `/flow` continues from where the task stopped, to the next gate.
- `/flow status` shows the task, the next step and any gate waiting for you (read only).
- `/flow approve <step>` records your approval of a gate. It runs nothing.
- `/flow start <description>` forces a new task whose text starts with a word such as approve.

## Gates
`requirements` (approve the scope) and `deliver` (approve the release) are always gates.
To add more, create `docs/flow.config.json`:

    { "extraGates": ["design"] }

Only `extraGates` is accepted; the two required gates cannot be removed. The flow never
pushes, opens a pull request or merges: after `deliver` you do that yourself.

## State
`docs/flow-state.json` is written by the flow: the task, the completed steps, the
approved gates and the last failure. To abandon a task, delete it.

## Cost
A run starts several agents, each with its own context, so it costs more than typing the
commands yourself. For small changes use the manual commands. To see what a run cost:

    node <path-to-claude-harness>/scripts/flow-report.js --project <this repo>

It lists tokens per agent and phase from Claude Code's own run records.
