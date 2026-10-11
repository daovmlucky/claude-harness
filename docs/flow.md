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

## Arguments and the spec
Only the exact forms above are commands. `/flow approve requirements now`, `/flow continue` and
`/flow Status` are not commands: they start a new task whose description is that text, or are
refused while a task is in progress.

`/flow` writes `docs/spec.md` (the requirements step) and `docs/plan.md` (the breakdown step) for
the task you give it, replacing what is there. Use it for a task-sized change, or commit your
spec first.

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

## Troubleshooting

`script contains control characters that would be hidden in the approval dialog` means the workflow file has CRLF line endings (git `core.autocrlf=true` writes them on checkout). Fix it in two steps:

1. Add the `.gitattributes` line from `product-template/gitattributes.tmpl` (`.claude/workflows/*.js text eol=lf`) to the repo.
2. Rewrite the workflow file with LF line endings:

       node -e "const f='.claude/workflows/flow.js',fs=require('fs');fs.writeFileSync(f,fs.readFileSync(f,'latin1').replace(/\r\n/g,'\n'),'latin1')"
