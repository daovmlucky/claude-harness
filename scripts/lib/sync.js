// sync.js — decide and apply harness -> product updates (spec 5.0).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { listManaged, readManifest, copyFile, sha256, walk, toPosix } = require('./fsutil');
const { harnessState, gitOut } = require('./git');
const { major } = require('./version');

class MajorVersionError extends Error {}

// files sync must never touch, even if a version file lists them
const PROTECTED = ['.claude/settings.json', '.claude/settings.local.json', '.claude/.harness-version'];

function versionPath(productRoot) {
  return path.join(productRoot, '.claude', '.harness-version');
}

function readVersion(productRoot) {
  const f = versionPath(productRoot);
  if (!fs.existsSync(f)) {
    throw new Error(`not a harness product (missing .claude/.harness-version): ${productRoot}`);
  }
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

// Deny rules the template ships that the product's settings.json lacks.
// Report only: settings.json belongs to the product and is never written.
function settingsMissing(harnessRoot, productRoot) {
  const deny = (o) => ((o || {}).permissions || {}).deny || [];
  const want = deny(readJson(path.join(harnessRoot, 'product-template', '.claude', 'settings.json')));
  const have = new Set(deny(readJson(path.join(productRoot, '.claude', 'settings.json'))));
  return want.filter((r) => !have.has(r));
}

function planSync(harnessRoot, productRoot) {
  const version = readVersion(productRoot);
  const versionTo = readManifest(harnessRoot).harnessVersion;
  const versionFrom = version.harnessVersion;
  if (!versionFrom) throw new Error(`.harness-version has no harnessVersion: ${productRoot}`);
  if (major(versionFrom) !== major(versionTo)) {
    throw new MajorVersionError(`major upgrade, not applied: product is on ${versionFrom}, harness is ${versionTo}`);
  }

  const recorded = version.files || {};
  const root = path.resolve(productRoot);
  for (const rel of Object.keys(recorded)) {
    // a tampered or corrupt version file must never make us touch files outside the product
    const abs = path.resolve(root, rel);
    if (rel.includes('\\') || path.isAbsolute(rel) || rel.split('/').includes('..')
      || path.posix.normalize(rel) !== rel || rel.endsWith('/')
      || !abs.startsWith(root + path.sep) || PROTECTED.includes(rel.toLowerCase())
      // NTFS alternate data streams (x::$DATA) and 8.3 short names (SETTIN~1.JSO) alias real files
      || rel.includes(':') || rel.includes('~')) {
      throw new Error(`unsafe path in .harness-version: ${rel}`);
    }
  }
  const wanted = listManaged(harnessRoot);
  const plan = {
    add: [], update: [], remove: [], conflict: [], kept: [], current: [], refresh: [],
    versionFrom, versionTo, settingsMissing: [],
  };

  for (const rel of wanted) {
    const src = sha256(path.join(harnessRoot, rel));
    const dstPath = path.join(productRoot, rel);
    const dst = fs.existsSync(dstPath) ? sha256(dstPath) : null;
    const rec = recorded[rel];

    if (dst === src) {
      plan.current.push(rel);
      if (rec !== dst) plan.refresh.push(rel);             // identical now, but the record is stale
    } else if (rec === src) plan.kept.push(rel);            // harness unchanged; product diverged on purpose
    else if (dst === null) (rec ? plan.conflict : plan.add).push(rel);
    else if (rec && dst === rec) plan.update.push(rel);     // product never touched it
    else plan.conflict.push(rel);                           // product edited it (or created it differently)
  }

  // readdir never yields 8.3 or stream names, so only a case-exact listing entry may be deleted
  const claudeDir = path.join(productRoot, '.claude');
  const existingClaude = new Set(fs.existsSync(claudeDir)
    ? walk(claudeDir).map((f) => toPosix(path.relative(productRoot, f))) : []);
  for (const rel of Object.keys(recorded)) {
    if (wanted.includes(rel)) continue;
    const dstPath = path.join(productRoot, rel);
    if (!fs.existsSync(dstPath)) continue;
    // never delete anything outside .claude/ or anything that is not a real, case-exact entry
    const removable = rel.startsWith('.claude/') && existingClaude.has(rel) && sha256(dstPath) === recorded[rel];
    (removable ? plan.remove : plan.conflict).push(rel);
  }

  plan.settingsMissing = settingsMissing(harnessRoot, productRoot);
  return plan;
}

function hasChanges(plan) {
  return plan.add.length + plan.update.length + plan.remove.length + plan.refresh.length > 0
    || plan.versionFrom !== plan.versionTo;
}

function applySync(harnessRoot, productRoot, plan) {
  const files = { ...readVersion(productRoot).files };
  for (const rel of [...plan.add, ...plan.update]) {
    copyFile(harnessRoot, productRoot, rel);
    files[rel] = sha256(path.join(productRoot, rel));
  }
  for (const rel of plan.remove) {
    fs.rmSync(path.join(productRoot, rel));
    delete files[rel];
  }
  // identical files: refresh the record so a resolved conflict stops being one
  for (const rel of plan.current) files[rel] = sha256(path.join(productRoot, rel));
  // conflict + kept keep their old recorded hash on purpose

  const state = harnessState(harnessRoot);
  fs.writeFileSync(versionPath(productRoot), JSON.stringify({
    harnessVersion: plan.versionTo,
    harnessCommit: state.commit,
    harnessDirty: state.dirty,
    syncedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n');
}

function newCommands(plan) {
  return plan.add.flatMap((rel) => {
    const m = /^\.claude\/(?:commands\/([^/]+)\.md|workflows\/([^/]+)\.js)$/.exec(rel);
    return m ? [`/${m[1] || m[2]}`] : [];
  });
}

function formatPlan(name, plan) {
  const head = plan.versionFrom === plan.versionTo
    ? `${name} (${plan.versionTo})`
    : `${name} (${plan.versionFrom} -> ${plan.versionTo})`;
  const counts = ['add', 'update', 'remove', 'conflict', 'kept']
    .filter((k) => plan[k].length)
    .map((k) => `${plan[k].length} ${k}`);
  const lines = [counts.length ? `${head}: ${counts.join(', ')}` : `${head}: up to date`];
  for (const k of ['add', 'update', 'remove']) for (const f of plan[k]) lines.push(`  ${k.padEnd(8)} ${f}`);
  for (const f of plan.conflict) lines.push(`  CONFLICT ${f}  (edited in the product, not overwritten)`);
  for (const f of plan.kept) lines.push(`  kept     ${f}  (local edit, harness unchanged)`);
  for (const c of newCommands(plan)) lines.push(`  new: ${c} - see CHANGELOG`);
  for (const r of plan.settingsMissing) {
    lines.push(`  settings: missing deny rule "${r}" - add it to .claude/settings.json by hand`);
  }
  return lines.join('\n');
}

// Apply happens in a separate worktree so a Claude Code session running in the
// product's own directory never sees files change under it. Never commits.
function createSyncWorktree(productRoot, version) {
  const status = gitOut(['status', '--porcelain', '--', '.claude'], productRoot);
  if (status === null) throw new Error(`not a git repository: ${productRoot}`);
  if (gitOut(['rev-parse', 'HEAD'], productRoot) === null) {
    throw new Error(`product has no commits yet; make the first commit before syncing: ${productRoot}`);
  }
  if (status !== '') {
    throw new Error('product has uncommitted changes under .claude/; commit or stash them before syncing');
  }
  const branch = `chore/harness-sync-v${version}`;
  const dir = path.join(path.dirname(productRoot), `${path.basename(productRoot)}-sync`);
  if (fs.existsSync(dir)) {
    const current = gitOut(['branch', '--show-current'], dir);
    if (current === branch) return { dir, branch, reused: true };
    throw new Error(`${dir} already exists (${current ? `on branch "${current}"` : 'not a git worktree'}); move it away or remove it, then retry`);
  }
  if (gitOut(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], productRoot)) {
    throw new Error(`branch ${branch} already exists from an earlier sync; delete it with: git branch -D ${branch} (or bump harnessVersion) and retry`);
  }
  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, dir], { cwd: productRoot, stdio: 'pipe' });
  } catch (e) {
    throw new Error(`could not create worktree ${dir} on ${branch}: ${String(e.stderr || e.message).trim()}`);
  }
  return { dir, branch, reused: false };
}

module.exports = { MajorVersionError, planSync, hasChanges, applySync, formatPlan, createSyncWorktree };
