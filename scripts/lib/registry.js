// registry.js — local list of product repos created from this harness.
// Lives in <harness>/.harness/products.json (gitignored: holds machine paths).
const fs = require('fs');
const path = require('path');

function registryFile(harnessRoot) {
  return path.join(harnessRoot, '.harness', 'products.json');
}

function readRegistry(harnessRoot) {
  const f = registryFile(harnessRoot);
  if (!fs.existsSync(f)) return [];
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`registry is not valid JSON: ${f} (${e.message})`);
  }
}

function registerProduct(harnessRoot, entry) {
  const list = readRegistry(harnessRoot).filter((p) => p.path !== entry.path);
  list.push(entry);
  fs.mkdirSync(path.dirname(registryFile(harnessRoot)), { recursive: true });
  fs.writeFileSync(registryFile(harnessRoot), JSON.stringify(list, null, 2) + '\n');
}

module.exports = { readRegistry, registerProduct };
