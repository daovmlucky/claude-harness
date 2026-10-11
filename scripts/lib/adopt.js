// adopt.js — bring a product repo that was NOT created by new-product.js under the sync.
// Writes only <dir>/.claude/.harness-version, recording the managed files that are
// identical to the harness. Differing files are left unrecorded so the next sync
// reports them as conflicts instead of overwriting them. Never commits.
const fs = require('fs');
const path = require('path');
const { listManaged, readManifest, sha256 } = require('./fsutil');
const { harnessState, gitOut } = require('./git');
const { registerProduct } = require('./registry');
const { readSkip } = require('./skip');

function adoptProduct({ harnessRoot, productDir, name, register = true }) {
  const dir = path.resolve(productDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`directory not found: ${dir}`);
  if (!fs.existsSync(path.join(dir, '.claude'))) throw new Error(`not a Claude Code project (no .claude/): ${dir}`);
  const vf = path.join(dir, '.claude', '.harness-version');
  if (fs.existsSync(vf)) throw new Error(`already adopted (.claude/.harness-version exists): ${dir}`);
  if (gitOut(['rev-parse', '--is-inside-work-tree'], dir) !== 'true') throw new Error(`not a git repository: ${dir}`);
  const version = readManifest(harnessRoot).harnessVersion;
  if (!version) throw new Error('harness.manifest.json has no harnessVersion');

  const skip = new Set(readSkip(dir));
  const files = {};
  const identical = [];
  const differs = [];
  const missing = [];
  const skipped = [];
  for (const rel of listManaged(harnessRoot)) {
    if (skip.has(rel)) { skipped.push(rel); continue; }
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) { missing.push(rel); continue; }
    const mine = sha256(p);
    if (mine === sha256(path.join(harnessRoot, rel))) { files[rel] = mine; identical.push(rel); } else differs.push(rel);
  }

  const state = harnessState(harnessRoot);
  fs.writeFileSync(vf, JSON.stringify({
    harnessVersion: version,
    harnessCommit: state.commit,
    harnessDirty: state.dirty,
    syncedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n');
  if (register) registerProduct(harnessRoot, { name: name || path.basename(dir), path: dir });
  return { dir, version, identical, differs, missing, skipped };
}

module.exports = { adoptProduct };
