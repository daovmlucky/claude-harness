// skip.js — a product can opt out of managed files with .claude/harness.skip.json:
//   { "skip": ["<managed path>", ...] }
// The file belongs to the product; sync never writes it.
const fs = require('fs');
const path = require('path');

function readSkip(productRoot) {
  const f = path.join(productRoot, '.claude', 'harness.skip.json');
  if (!fs.existsSync(f)) return [];
  let o;
  try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error('.claude/harness.skip.json is not valid JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some((k) => k !== 'skip')) {
    throw new Error('.claude/harness.skip.json must be an object with only a "skip" list');
  }
  const okPath = (x) => typeof x === 'string' && x !== '' && !x.includes('\\') && !path.isAbsolute(x) && !x.split('/').includes('..');
  if (!Array.isArray(o.skip) || !o.skip.every(okPath)) {
    throw new Error('.claude/harness.skip.json: "skip" must list relative paths with forward slashes');
  }
  return o.skip;
}

module.exports = { readSkip };
