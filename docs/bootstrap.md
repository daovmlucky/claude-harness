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

## Bringing an older repo under the sync

A repo made before `new-product.js` existed has no `.claude/.harness-version`, so sync
refuses it. Record it once:

    node scripts/sync-harness.js --adopt <repo>

This writes only `.claude/.harness-version` in the repo and registers the repo in the harness's `.harness/products.json`. The version file lists the managed files that are identical
to the harness (files the repo lists in `.claude/harness.skip.json` are ignored). Files that differ are reported as conflicts by later syncs and are never
overwritten; files that are missing are added. It commits nothing: commit the new file on
the base branch yourself, then run a dry run and `--apply` as usual. The sync worktree is
cut from `main`, else `master`; for any other branch pass `--base <branch>`.

### Opting out of a file

To keep a repo from receiving a managed file that is not generic for it, list the file in
the repo's own `.claude/harness.skip.json`:

    { "skip": [".claude/workflows/product-brainstorm.js"] }

Sync and `--adopt` then ignore those paths: they are never added, updated, reported as
conflicts or removed. The file belongs to the repo, so sync never writes it. An entry that
is not a managed file is reported as a probable typo.
Like the version file, commit it on the base branch (main or master): --apply works from that
branch, not from the files in your working directory.
