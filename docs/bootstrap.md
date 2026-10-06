# Bootstrapping a product repo

Create a new repo for a product, next to this one:

    node scripts/new-product.js ridgo --seed path/to/brief.md

This copies the workflows listed in `harness.manifest.json`, writes the
product's own `CLAUDE.md`, `docs/` skeleton and `.claude/settings.json` (which
denies merging PRs, pushing to `main` and force pushes; these rules are best-effort, since a bare
`git push` while on `main` cannot be blocked, so also enable branch protection on the
GitHub remote), runs `git init`, and records the repo
in `.harness/products.json`. It does not commit and does not create a remote.

When this harness changes, roll it out to every product repo:

    node scripts/sync-harness.js --all            # dry run: add / update / remove / conflict + changelog
    node scripts/sync-harness.js --all --apply    # writes into <product>-sync on chore/harness-sync-v<version>

A sync never commits or pushes and by default never touches the product's own working
directory (the `--in-place` exception is documented below): review `git -C <product>-sync diff`, commit there, open a PR, merge it
between two stages, then `git worktree remove <product>-sync`. The product needs
at least one commit and a clean `.claude/`. Files the product edited are
reported as conflicts and left alone. A major harness version is never synced
(`SKIPPED ... major upgrade, not applied`). `.claude/settings.json` belongs to
the product: a sync only warns about deny rules from the template that are
missing, so add those by hand.

Exception: `sync-harness.js <repo> --apply --in-place` writes straight into the product directory. It is for emergencies and tests only, works on a single repo, and is refused together with `--all`. Normal syncs always go through the `<product>-sync` worktree.
