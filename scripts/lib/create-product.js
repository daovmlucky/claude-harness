// create-product.js — bootstrap a product repo from claude-harness (spec 5.0).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { listManaged, readManifest, copyFile, sha256, walk, toPosix } = require('./fsutil');
const { harnessState } = require('./git');
const { registerProduct } = require('./registry');

const NAME_RE = /^[a-z][a-z0-9-]{1,39}$/;

function copyTemplate(templateRoot, target, name) {
  for (const f of walk(templateRoot)) {
    let rel = toPosix(path.relative(templateRoot, f));
    const rendered = rel.endsWith('.tmpl');
    if (rendered) rel = rel.slice(0, -'.tmpl'.length);
    if (path.posix.basename(rel) === 'gitignore') rel = path.posix.join(path.posix.dirname(rel), '.gitignore');
    const out = path.join(target, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (rendered) fs.writeFileSync(out, fs.readFileSync(f, 'utf8').split('{{NAME}}').join(name));
    else fs.copyFileSync(f, out);
  }
}

function buildProduct({ harnessRoot, name, parentDir, seed, register = true }) {
  // Validate everything BEFORE touching the disk.
  if (!NAME_RE.test(name)) {
    throw new Error(`invalid name "${name}": use lowercase letters, digits and dashes, 2-40 chars, starting with a letter`);
  }
  if (name.endsWith('-sync')) {
    throw new Error(`invalid name "${name}": the suffix -sync is reserved for sync worktrees`);
  }
  const target = path.join(parentDir, name);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
    throw new Error(`target exists and is not empty: ${target}`);
  }
  if (seed && !fs.existsSync(seed)) throw new Error(`seed file not found: ${seed}`);
  const harnessVersion = readManifest(harnessRoot).harnessVersion;
  if (!harnessVersion) throw new Error('harness.manifest.json has no harnessVersion');

  fs.mkdirSync(target, { recursive: true });

  const files = {};
  for (const rel of listManaged(harnessRoot)) {
    copyFile(harnessRoot, target, rel);
    files[rel] = sha256(path.join(target, rel));
  }

  copyTemplate(path.join(harnessRoot, 'product-template'), target, name);
  for (const d of ['docs/brainstorm', 'docs/ux', 'docs/adr']) {
    fs.mkdirSync(path.join(target, d), { recursive: true });
    fs.writeFileSync(path.join(target, d, '.gitkeep'), '');
  }
  if (seed) fs.copyFileSync(seed, path.join(target, 'docs', 'brainstorm', path.basename(seed)));

  const state = harnessState(harnessRoot);
  fs.writeFileSync(path.join(target, '.claude', '.harness-version'), JSON.stringify({
    harnessVersion,
    harnessCommit: state.commit,
    harnessDirty: state.dirty,
    syncedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n');

  execFileSync('git', ['init', '-b', 'main'], { cwd: target, stdio: 'ignore' });
  if (register) registerProduct(harnessRoot, { name, path: target });
  return { target };
}

// If anything fails halfway, do not leave a half-built directory behind.
// Only clean up when the name was valid and the directory did not exist before,
// so a bad name such as "../x" can never make us delete somebody else's folder.
function createProduct(opts) {
  const target = path.join(opts.parentDir, opts.name);
  const existed = fs.existsSync(target);
  try {
    return buildProduct(opts);
  } catch (e) {
    if (!existed && NAME_RE.test(opts.name) && fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    throw e;
  }
}

module.exports = { createProduct, NAME_RE };
