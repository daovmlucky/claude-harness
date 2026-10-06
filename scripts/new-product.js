#!/usr/bin/env node
// new-product.js — bootstrap a product repo from claude-harness.
// Usage: node scripts/new-product.js <name> [--dir <parent>] [--seed <file>]
// Creates <parent>/<name> (default parent: the folder that contains this harness),
// copies the managed workflows, runs `git init`. Never commits, never creates a remote.
const path = require('path');
const { createProduct } = require('./lib/create-product');

function opt(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function main() {
  const name = process.argv[2];
  if (!name || name.startsWith('--')) {
    console.error('usage: new-product.js <name> [--dir <parent>] [--seed <file>]');
    process.exit(1);
  }
  const harnessRoot = path.resolve(opt('--harness-root') || path.join(__dirname, '..'));
  const parentDir = path.resolve(opt('--dir') || path.dirname(harnessRoot));
  const seed = opt('--seed') ? path.resolve(opt('--seed')) : undefined;
  try {
    const { target } = createProduct({ harnessRoot, name, parentDir, seed });
    console.log(`created ${target}`);
    console.log('next: open it in Claude Code, review, and make the first commit yourself.');
    console.log('no remote was created and nothing was committed.');
  } catch (e) {
    console.error(`new-product failed: ${e.message}`);
    process.exit(1);
  }
}

main();
