// fsutil.js — file helpers shared by new-product.js and sync-harness.js.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const toPosix = (p) => p.split(path.sep).join('/');

// Hash of the file content with CRLF folded to LF. Git on Windows with
// core.autocrlf=true checks files out as CRLF; without this every managed file
// would look "edited by the product" inside a freshly checked-out worktree.
// latin1 round-trips arbitrary bytes, so nothing else is altered.
function sha256(file) {
  const normalized = Buffer.from(fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'harness.manifest.json'), 'utf8'));
}

// Every file the harness distributes: manifest `managed` entries (files or
// directories) minus `exclude`. Returns sorted posix-style relative paths.
function listManaged(root) {
  const manifest = readManifest(root);
  const exclude = new Set(manifest.exclude || []);
  const files = new Set();
  for (const entry of manifest.managed) {
    const abs = path.join(root, entry);
    if (!fs.existsSync(abs)) continue; // check-harness reports missing entries
    const list = fs.statSync(abs).isDirectory() ? walk(abs) : [abs];
    for (const f of list) {
      const rel = toPosix(path.relative(root, f));
      if (!exclude.has(rel)) files.add(rel);
    }
  }
  return [...files].sort();
}

function copyFile(srcRoot, dstRoot, rel) {
  const dst = path.join(dstRoot, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(srcRoot, rel), dst);
}

module.exports = { sha256, walk, toPosix, readManifest, listManaged, copyFile };
