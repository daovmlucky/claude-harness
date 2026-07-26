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
