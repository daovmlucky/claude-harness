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
  let list;
  try {
    list = JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch (e) {
    throw new Error(`registry is not valid JSON: ${f} (${e.message})`);
  }
  if (!Array.isArray(list)) throw new Error(`registry is malformed: ${f} (not an array)`);
  list.forEach((p, i) => {
    if (!p || typeof p.name !== 'string' || typeof p.path !== 'string') {
      throw new Error(`registry is malformed: ${f} (entry ${i} needs string name and path)`);
    }
  });
  return list;
}

function registerProduct(harnessRoot, entry) {
  const list = readRegistry(harnessRoot).filter((p) => p.path !== entry.path);
  list.push(entry);
  fs.mkdirSync(path.dirname(registryFile(harnessRoot)), { recursive: true });
  fs.writeFileSync(registryFile(harnessRoot), JSON.stringify(list, null, 2) + '\n');
}

module.exports = { readRegistry, registerProduct };
