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

## Product repos
This repo is the source of truth for how a new product is built, and the place
product repos are created from.
- `node scripts/new-product.js <name>` creates `../<name>` (copies the managed
  workflows listed in `harness.manifest.json`, runs `git init`, no commit, no remote).
- Change a flow or add a step **only here**, then bump `harnessVersion` in
  `harness.manifest.json`, add a `## <version>` entry to `CHANGELOG.md`, and run
  `node scripts/sync-harness.js --all` (dry run) before `--all --apply`.
- A sync never commits, never pushes, by default never touches a product's working
  directory (it writes to `<product>-sync`; the `--in-place` exception is documented below), never overwrites a file the product
  edited (reported as a conflict), and never writes `.claude/settings.json`.
- A product's `.claude/settings.json` denies merging PRs and the common ways to push to `main`
  or force-push. That is a best-effort stop, not a guarantee (a bare `git push` while on
  `main` cannot be blocked): enable branch protection on the GitHub remote too.
- Product-specific material (briefs, specs, designs) belongs in the product repo,
  never here: this repo is public.
- Exception: `sync-harness.js <repo> --apply --in-place` writes straight into the
  product directory. It is for emergencies and tests only, works on a single repo,
  and is refused together with `--all`. Normal syncs always go through the
  `<product>-sync` worktree.
- Full usage: see docs/bootstrap.md.

### Classifying a harness change (decides the version bump)
A change is **not breaking** only if all four hold:
1. State files a product already has (`gates.json`, `spec.md`, `backlog.md`) stay valid unchanged.
2. Existing commands and workflows keep their names and meaning.
3. No new settings, env flag or Claude Code version is needed to run.
4. Whatever is added does not block a stage the product is in the middle of.

| Bump | What | Synced? |
|---|---|---|
| patch | bug fix, prompt wording | yes |
| minor | additive, e.g. an optional stage or a report-only quality check | yes |
| major | breaks any of the four (e.g. Sub-agents -> Agent Teams, new `gates.json` shape, renamed command) | **never**: sync refuses |

A new blocking quality gate is minor only if products opt in to enforcement
themselves; switching it on for every repo is major. Products on an old major
line are patched by keeping a `vN` branch of this repo and running
`sync-harness.js` with `--harness-root` pointing at a worktree of that branch.
