#!/usr/bin/env node
// new-product.js — bootstrap a product repo from claude-harness.
// Usage: node scripts/new-product.js <name> [--dir <parent>] [--seed <file>]
// Creates <parent>/<name> (default parent: the folder that contains this harness),
// copies the managed workflows, runs `git init`. Never commits, never creates a remote.
const path = require('path');
const { createProduct } = require('./lib/create-product');
const { parseArgs } = require('./lib/args');

const USAGE = 'usage: new-product.js <name> [--dir <parent>] [--seed <file>]';

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2), { values: ['--dir', '--seed', '--harness-root'] });
    if (parsed.positional.length > 1) throw new Error(`unexpected argument ${parsed.positional[1]}`);
  } catch (e) {
    console.error(`new-product: ${e.message}`);
    console.error(USAGE);
    process.exit(1);
  }
  const name = parsed.positional[0];
  if (!name) {
    console.error(USAGE);
    process.exit(1);
  }
  const o = parsed.values;
  const harnessRoot = path.resolve(o['--harness-root'] || path.join(__dirname, '..'));
  const parentDir = path.resolve(o['--dir'] || path.dirname(harnessRoot));
  const seed = o['--seed'] ? path.resolve(o['--seed']) : undefined;
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
