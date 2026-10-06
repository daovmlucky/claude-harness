// lib.test.js — unit checks for scripts/lib/*.
const fs = require('fs');
const path = require('path');
const { makeChecker, mkTmp, write, rm, makeFakeHarness } = require('./lib/testutil');
const { listManaged, sha256, readManifest } = require('./lib/fsutil');
const { major, compare, changelogBetween, hasChangelogEntry } = require('./lib/version');
const { harnessState } = require('./lib/git');
const { readRegistry, registerProduct } = require('./lib/registry');
const { check, done } = makeChecker();

const root = mkTmp('lib-');
makeFakeHarness(root);

const files = listManaged(root);
check('lists managed files, posix style, sorted',
  JSON.stringify(files) === JSON.stringify(['.claude/commands/a.md', '.claude/workflows/w.js']));
check('excludes manifest exclude entries', !files.includes('.claude/commands/skip.md'));
check('never lists settings.local.json', !files.some((f) => f.includes('settings.local')));
check('readManifest returns the parsed manifest', readManifest(root).harnessVersion === '1.0.0');

const a = path.join(root, '.claude/commands/a.md');
const w = path.join(root, '.claude/workflows/w.js');
check('sha256 is content based', sha256(a) === sha256(a) && sha256(a) !== sha256(w));
const crlf = path.join(root, 'crlf.txt');
const lf = path.join(root, 'lf.txt');
write(crlf, 'one\r\ntwo\r\n');
write(lf, 'one\ntwo\n');
check('sha256 ignores CRLF vs LF (core.autocrlf on Windows)', sha256(crlf) === sha256(lf));
check('sha256 still tells different content apart', sha256(lf) !== sha256(a));

// protected files and OS junk are never listed, even when a manifest entry covers them
{
  const r2 = mkTmp('lib2-');
  write(path.join(r2, 'harness.manifest.json'), JSON.stringify({ harnessVersion: '1.0.0', managed: ['.claude'] }));
  for (const f of ['commands/a.md', 'settings.json', 'settings.local.json', '.harness-version',
    '.DS_Store', 'Thumbs.db', 'commands/.DS_Store', 'commands/Thumbs.db']) write(path.join(r2, '.claude', f), 'x\n');
  check('a manifest entry covering .claude lists only real managed files',
    JSON.stringify(listManaged(r2)) === JSON.stringify(['.claude/commands/a.md']));
  rm(r2);
}

// --- version helpers ---
check('major parses', major('2.3.4') === 2);
check('compare orders numerically', compare('1.2.0', '1.10.0') === -1 && compare('2.0.0', '1.9.9') === 1 && compare('1.0.0', '1.0.0') === 0);
let verr = '';
try { major('1.0'); } catch (e) { verr = e.message; }
check('rejects a malformed version', /invalid version/.test(verr));
const log = '# Changelog\n\n## 1.2.0\n- minor\n\n## 1.1.0\n- added quality check\n\n## 1.0.0\n- initial\n';
const between = changelogBetween(log, '1.0.0', '1.2.0');
check('changelogBetween returns (from, to] ascending', between.map((e) => e.version).join() === '1.1.0,1.2.0');
check('changelogBetween keeps the body', /quality check/.test(between[0].body));
check('changelogBetween is empty when from == to', changelogBetween(log, '1.2.0', '1.2.0').length === 0);
check('hasChangelogEntry finds only real entries', hasChangelogEntry(log, '1.1.0') && !hasChangelogEntry(log, '1.3.0'));

// --- real manifest + template ---
const repo = path.resolve(__dirname, '..');
const real = listManaged(repo);
check('real manifest includes explore command', real.includes('.claude/commands/explore.md'));
check('real manifest includes reviewer agent', real.includes('.claude/agents/reviewer.md'));
check('real manifest includes harness skill', real.includes('.claude/skills/harness/SKILL.md'));
check('real manifest includes product-brainstorm workflow', real.includes('.claude/workflows/product-brainstorm.js'));
check('real manifest excludes interview-prep workflow', !real.includes('.claude/workflows/study-research.js'));
check('real manifest excludes deep-dive command', !real.includes('.claude/commands/deep-dive.md'));
check('real manifest never lists settings.local.json', !real.some((f) => f.includes('settings.local')));
const realManifest = JSON.parse(fs.readFileSync(path.join(repo, 'harness.manifest.json'), 'utf8'));
check('real manifest has harnessVersion 1.0.0', realManifest.harnessVersion === '1.0.0');
check('real CHANGELOG has an entry for the manifest version',
  hasChangelogEntry(fs.readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'), realManifest.harnessVersion));
for (const t of ['CLAUDE.md.tmpl', 'gitignore.tmpl', 'docs/gates.json', 'docs/run-log.md', '.claude/settings.json']) {
  check(`template has ${t}`, fs.existsSync(path.join(repo, 'product-template', t)));
}
const gates = JSON.parse(fs.readFileSync(path.join(repo, 'product-template/docs/gates.json'), 'utf8'));
check('template gates.json lists G0..G3b as null',
  ['G0', 'G1', 'G2', 'G3a', 'G3b'].every((g) => g in gates && gates[g] === null));
const deny = JSON.parse(fs.readFileSync(path.join(repo, 'product-template/.claude/settings.json'), 'utf8')).permissions.deny;
check('template denies gh pr merge', deny.includes('Bash(gh pr merge *)'));
check('template denies push to main', deny.includes('Bash(git push origin main *)'));
check('template denies force push', deny.includes('Bash(git push --force *)'));
for (const rule of ['Bash(git push -u origin main)', 'Bash(git push -u origin main *)', 'Bash(git push origin HEAD:main)',
  'Bash(git push origin HEAD:main *)', 'Bash(git push --force-with-lease)', 'Bash(git push --force-with-lease *)']) {
  check('template denies ' + rule, deny.includes(rule));
}

// --- git state + registry ---
check('harnessState outside git is unknown', harnessState(root).commit === 'unknown' && harnessState(root).dirty === false);
check('empty registry reads as []', JSON.stringify(readRegistry(root)) === '[]');
registerProduct(root, { name: 'p1', path: '/x/p1' });
registerProduct(root, { name: 'p1-renamed', path: '/x/p1' });
registerProduct(root, { name: 'p2', path: '/x/p2' });
check('registerProduct replaces the entry with the same path',
  readRegistry(root).map((p) => p.name).join() === 'p1-renamed,p2');
write(path.join(root, '.harness/products.json'), 'not json');
let regErr = '';
try { readRegistry(root); } catch (e) { regErr = e.message; }
check('corrupt registry gives a clear error', /not valid JSON/.test(regErr) && /products\.json/.test(regErr));

rm(root);
done('lib');
