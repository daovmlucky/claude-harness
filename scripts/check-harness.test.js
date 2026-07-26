// check-harness.test.js — validates the acceptance criteria in docs/spec.md
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, 'check-harness.js');
const REPO = path.resolve(__dirname, '..');

function run(root) {
  try {
    const out = execFileSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

let ok = true;
function check(name, cond) { if (!cond) { console.error(`FAIL: ${name}`); ok = false; } }

// AC1: intact repo → exit 0, prints "harness OK"
const intact = run(REPO);
check('AC1 intact exits 0', intact.code === 0);
check('AC1 prints "harness OK"', /harness OK/.test(intact.out));

// AC2: a fixture missing one command → exit 1, names the missing file
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
copyDir(path.join(REPO, '.claude'), path.join(fixture, '.claude'));
fs.rmSync(path.join(fixture, '.claude', 'commands', 'deliver.md'));
const missing = run(fixture);
check('AC2 missing command exits 1', missing.code === 1);
check('AC2 names deliver.md', /deliver\.md/.test(missing.out));
fs.rmSync(fixture, { recursive: true, force: true });

if (!ok) process.exit(1);
console.log('PASS (test suite)');
