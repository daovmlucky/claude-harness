#!/usr/bin/env node
// sync-harness.js — push harness workflow updates into product repos.
// Usage: node scripts/sync-harness.js <product-dir> | --all  [--apply] [--in-place]
//   default is a dry run. --apply writes into a separate worktree
//   (<product>-sync), never into the product's own working directory, and
//   never commits or pushes. --in-place writes straight into the product
//   directory (emergency/testing exception, single repo only, never with
//   --all). Major version jumps are never applied.
const fs = require('fs');
const path = require('path');
const {
  planSync, hasChanges, applySync, formatPlan, createSyncWorktree, MajorVersionError,
} = require('./lib/sync');
const { readRegistry } = require('./lib/registry');
const { changelogBetween } = require('./lib/version');

const flag = (name) => process.argv.includes(name);
function opt(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
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

function syncOne(harnessRoot, name, dir, { apply, inPlace }) {
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
  const wt = createSyncWorktree(dir, plan.versionTo);
  if (wt.reused) console.log(`  reusing existing worktree ${wt.dir}`);
  const wtPlan = planSync(harnessRoot, wt.dir);
  console.log(formatPlan(`${name} (worktree)`, wtPlan));
  applySync(harnessRoot, wt.dir, wtPlan);
  console.log(`  applied in ${wt.dir} on branch ${wt.branch}${wt.base ? ` (base ${wt.base}, main)` : ''}`);
  console.log(`  nothing was committed and ${dir} was not touched`);
  console.log(`  review:   git -C "${wt.dir}" diff`);
  console.log('  then commit, open a PR, and merge it between two stages, never in the middle of one');
  console.log(`  clean up: git worktree remove "${wt.dir}"`);
}

function main() {
  const target = process.argv[2];
  if (!target || (target.startsWith('--') && target !== '--all')) {
    console.error('usage: sync-harness.js <product-dir> | --all [--apply] [--in-place]');
    console.error('  --in-place is an emergency/testing exception: it writes into the product directory (single repo only)');
    process.exit(1);
  }
  const harnessRoot = path.resolve(opt('--harness-root') || path.join(__dirname, '..'));
  const options = { apply: flag('--apply'), inPlace: flag('--in-place') };
  if (target === '--all' && options.inPlace) {
    console.error('sync failed: --in-place cannot be combined with --all');
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
