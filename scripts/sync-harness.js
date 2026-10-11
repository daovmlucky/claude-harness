#!/usr/bin/env node
// sync-harness.js — push harness workflow updates into product repos.
// Usage: node scripts/sync-harness.js <product-dir> | --all  [--apply] [--in-place]
//   default is a dry run. --apply writes into a separate worktree
//   (<product>-sync), never into the product's own working directory, and
//   never commits or pushes. --in-place writes straight into the product
//   directory (emergency/testing exception, single repo only, never with
//   --all). Major version jumps are never applied.
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const {
  planSync, hasChanges, applySync, formatPlan, createSyncWorktree, MajorVersionError,
} = require('./lib/sync');
const { readRegistry } = require('./lib/registry');
const { changelogBetween } = require('./lib/version');
const { parseArgs } = require('./lib/args');
const { adoptProduct } = require('./lib/adopt');

function usage(prefix) {
  if (prefix) console.error(`sync-harness: ${prefix}`);
  console.error('usage: sync-harness.js <product-dir> | --all [--apply] [--in-place] [--base <branch>]');
  console.error('       sync-harness.js --adopt <product-dir>');
  console.error('  --adopt records an older repo (not made by new-product.js) so it can be synced; it writes only .claude/.harness-version in the repo and registers the repo in the harness\'s .harness/products.json');
  console.error('  --base picks the branch the sync worktree is cut from (default: main, else master); single repo only');
  console.error('  --in-place is an emergency/testing exception: it writes into the product directory (single repo only)');
  process.exit(1);
}

function printChangelog(harnessRoot, plan) {
  if (plan.versionFrom === plan.versionTo) return;
  const f = path.join(harnessRoot, 'CHANGELOG.md');
  if (!fs.existsSync(f)) return;
  for (const e of changelogBetween(fs.readFileSync(f, 'utf8'), plan.versionFrom, plan.versionTo)) {
    console.log(`  changelog ${e.version}:`);
    for (const line of e.body.split('\n')) console.log(`    ${line}`);
  }
}

function syncOne(harnessRoot, name, dir, { apply, inPlace, base }) {
  let plan;
  try {
    plan = planSync(harnessRoot, dir);
  } catch (e) {
    if (e instanceof MajorVersionError) {
      console.log(`SKIPPED ${name}: ${e.message}`);
      return;
    }
    throw e;
  }
  console.log(formatPlan(name, plan));
  printChangelog(harnessRoot, plan);
  if (!apply || !hasChanges(plan)) return;

  if (inPlace) {
    applySync(harnessRoot, dir, plan);
    console.log('  applied in place (nothing committed)');
    return;
  }
  const wt = createSyncWorktree(dir, plan.versionTo, base);
  if (wt.reused) console.log(`  reusing existing worktree ${wt.dir}`);
  let wtPlan;
  try {
    wtPlan = planSync(harnessRoot, wt.dir);
    const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
    if (!same(wtPlan.skipped, plan.skipped) || !same(wtPlan.skipUnknown, plan.skipUnknown)) {
      throw new Error(`the skip list on the base branch (${wt.baseName ? `"${wt.baseName}"` : 'the sync worktree'}) differs from the checked-out branch; commit .claude/harness.skip.json on the base branch, then retry`);
    }
  } catch (e) {
    if (!wt.reused) {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt.dir], { cwd: dir, stdio: 'ignore' }); } catch (e2) { /* best effort */ }
      try { execFileSync('git', ['branch', '-D', wt.branch], { cwd: dir, stdio: 'ignore' }); } catch (e2) { /* best effort */ }
    }
    throw e;
  }
  console.log(formatPlan(`${name} (worktree)`, wtPlan));
  applySync(harnessRoot, wt.dir, wtPlan);
  console.log(`  applied in ${wt.dir} on branch ${wt.branch}${wt.base ? ` (base ${wt.base}, ${wt.baseName})` : ''}`);
  console.log(`  nothing was committed and ${dir} was not touched`);
  console.log(`  review:   git -C "${wt.dir}" diff`);
  console.log('  then commit, open a PR, and merge it between two stages, never in the middle of one');
  console.log(`  clean up: git worktree remove "${wt.dir}"`);
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2), { values: ['--harness-root', '--base'], flags: ['--all', '--apply', '--in-place', '--adopt'] });
  } catch (e) {
    usage(e.message);
  }
  const all = parsed.flags.has('--all');
  const extra = parsed.positional.slice(all ? 0 : 1)[0];
  if (extra !== undefined) usage(`unexpected argument ${extra}`);
  if (!all && !parsed.positional.length) usage();
  const target = all ? '--all' : parsed.positional[0];
  const harnessRoot = path.resolve(parsed.values['--harness-root'] || path.join(__dirname, '..'));
  const options = { apply: parsed.flags.has('--apply'), inPlace: parsed.flags.has('--in-place'), base: parsed.values['--base'] };
  if (target === '--all' && options.inPlace) {
    console.error('sync failed: --in-place cannot be combined with --all');
    process.exit(1);
  }
  if (parsed.flags.has('--adopt')) {
    if (all || options.apply || options.inPlace || options.base !== undefined) {
      console.error('sync failed: --adopt cannot be combined with --all, --apply, --in-place or --base');
      process.exit(1);
    }
    try {
      const r = adoptProduct({ harnessRoot, productDir: target });
      console.log(`adopted ${r.dir} at harness ${r.version}`);
      console.log(`  recorded ${r.identical.length} identical file(s); ${r.differs.length} differ (reported as conflicts, never overwritten); ${r.missing.length} missing (added by the next sync); ${r.skipped.length} skipped by .claude/harness.skip.json`);
      for (const f of r.differs) console.log(`  differs  ${f}`);
      for (const f of r.missing) console.log(`  missing  ${f}`);
      console.log('  wrote .claude/.harness-version; nothing was committed');
      console.log('  next: commit it on the base branch, then do a dry run:');
      if (r.skipped.length > 0) console.log('  commit .claude/harness.skip.json on the base branch too');
      console.log(`    git -C "${r.dir}" add .claude/.harness-version && git -C "${r.dir}" commit -m "chore: adopt harness sync"`);
      console.log(`    node scripts/sync-harness.js "${r.dir}"`);
      process.exit(0);
    } catch (e) {
      console.error(`sync failed: ${e.message}`);
      process.exit(1);
    }
  }
  if (target === '--all' && options.base !== undefined) {
    console.error('sync failed: --base cannot be combined with --all');
    process.exit(1);
  }
  let failed = false;

  if (target === '--all') {
    let products;
    try {
      products = readRegistry(harnessRoot);
    } catch (e) {
      console.error(`sync failed: ${e.message}`);
      process.exit(1);
    }
    if (!products.length) console.log('no product repos registered');
    for (const p of products) {
      if (!fs.existsSync(p.path)) {
        console.log(`WARN ${p.name}: missing directory ${p.path} (skipped)`);
        continue;
      }
      try {
        syncOne(harnessRoot, p.name, p.path, options);
      } catch (e) {
        console.error(`sync failed for ${p.name}: ${e.message}`);
        failed = true;
      }
    }
  } else {
    const dir = path.resolve(target);
    try {
      syncOne(harnessRoot, path.basename(dir), dir, options);
    } catch (e) {
      console.error(`sync failed: ${e.message}`);
      process.exit(1);
    }
  }

  if (!options.apply) console.log('dry run: nothing written. Re-run with --apply to write.');
  process.exit(failed ? 1 : 0);
}

main();
