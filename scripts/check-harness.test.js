// check-harness.test.js — validates the acceptance criteria in docs/spec.md
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { staleNotes } = require('./check-harness');
const { createProduct } = require('./lib/create-product');
const { makeFakeHarness, write } = require('./lib/testutil');

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

// Helper: a fixture with everything check-harness verifies.
function fullFixture() {
  const f = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-full-'));
  copyDir(path.join(REPO, '.claude'), path.join(f, '.claude'));
  copyDir(path.join(REPO, 'product-template'), path.join(f, 'product-template'));
  for (const file of ['harness.manifest.json', 'CHANGELOG.md']) fs.copyFileSync(path.join(REPO, file), path.join(f, file));
  return f;
}

// AC3: complete fixture passes
const full = fullFixture();
const fullRun = run(full);
check('AC3 complete fixture exits 0', fullRun.code === 0);

// AC4: template that no longer denies gh pr merge → exit 1, says so
write(path.join(full, 'product-template/.claude/settings.json'), '{"permissions":{"deny":[]}}');
const noDeny = run(full);
check('AC4 template without merge deny exits 1', noDeny.code === 1 && /gh pr merge/.test(noDeny.out));
write(path.join(full, 'product-template/.claude/settings.json'), '{"permissions":{"allow":["Bash(gh pr merge *)"],"deny":[]}}');
const allowOnly = run(full);
check('AC4 a merge rule under allow does not count', allowOnly.code === 1 && /must deny/.test(allowOnly.out));
fs.rmSync(full, { recursive: true, force: true });

// AC5: manifest entry that does not exist → exit 1, names it
const brokenManifest = fullFixture();
write(path.join(brokenManifest, 'harness.manifest.json'), JSON.stringify({ harnessVersion: '1.0.0', managed: ['.claude/nope'], exclude: [] }));
const bm = run(brokenManifest);
check('AC5 manifest entry not found exits 1', bm.code === 1 && /manifest entry not found: \.claude\/nope/.test(bm.out));
fs.rmSync(brokenManifest, { recursive: true, force: true });

// AC7: a version without a CHANGELOG entry, and a malformed version → exit 1
const noEntry = fullFixture();
const nm = JSON.parse(fs.readFileSync(path.join(noEntry, 'harness.manifest.json'), 'utf8'));
nm.harnessVersion = '1.1.0';
write(path.join(noEntry, 'harness.manifest.json'), JSON.stringify(nm));
const ne = run(noEntry);
check('AC7 version without changelog entry exits 1', ne.code === 1 && /CHANGELOG\.md has no entry for 1\.1\.0/.test(ne.out));
nm.harnessVersion = 'one';
write(path.join(noEntry, 'harness.manifest.json'), JSON.stringify(nm));
const bad = run(noEntry);
check('AC7 malformed version exits 1', bad.code === 1 && /harnessVersion invalid/.test(bad.out));
fs.rmSync(noEntry, { recursive: true, force: true });

// AC6: stale product repos are reported as notes
const fakeHarness = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stale-'));
makeFakeHarness(fakeHarness);
const staleParent = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-stale-p-'));
createProduct({ harnessRoot: fakeHarness, name: 'old-one', parentDir: staleParent });
check('AC6 up-to-date product yields no note', staleNotes(fakeHarness).length === 0);
write(path.join(fakeHarness, '.claude/commands/a.md'), 'a v2\n');
const notes = staleNotes(fakeHarness);
check('AC6 stale product yields one note naming it',
  notes.length === 1 && /old-one: behind harness 1\.0\.0 -> 1\.0\.0 \(1 file\(s\)\)/.test(notes[0]));
write(path.join(fakeHarness, '.claude/commands/a.md'), 'a v1\n'); // files identical again: only the version differs
const fm = JSON.parse(fs.readFileSync(path.join(fakeHarness, 'harness.manifest.json'), 'utf8'));
fm.harnessVersion = '1.0.1';
write(path.join(fakeHarness, 'harness.manifest.json'), JSON.stringify(fm));
const versionOnly = staleNotes(fakeHarness);
check('AC6 a version-only bump is reported as such', versionOnly.length === 1 && /\(version only\)/.test(versionOnly[0]));
fm.harnessVersion = '2.0.0';
write(path.join(fakeHarness, 'harness.manifest.json'), JSON.stringify(fm));
const majorNotes = staleNotes(fakeHarness);
check('AC6 a major-behind product is reported as not applied', majorNotes.length === 1 && /old-one: major upgrade, not applied/.test(majorNotes[0]));
fs.rmSync(path.join(staleParent, 'old-one'), { recursive: true, force: true });
check('AC6 a registered but deleted product is skipped quietly', staleNotes(fakeHarness).length === 0);
fs.rmSync(fakeHarness, { recursive: true, force: true });
fs.rmSync(staleParent, { recursive: true, force: true });

if (!ok) process.exit(1);
console.log('PASS (test suite)');
