// new-product.test.js — createProduct() acceptance checks (spec 5.0).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeChecker, mkTmp, write, rm, makeFakeHarness, installScripts } = require('./lib/testutil');
const { readManifest } = require('./lib/fsutil');
const { createProduct } = require('./lib/create-product');
const { readRegistry } = require('./lib/registry');
const { check, done } = makeChecker();

const REPO = path.resolve(__dirname, '..');
function throws(fn) { try { fn(); return ''; } catch (e) { return e.message; } }
function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

const harness = mkTmp('np-h-');
makeFakeHarness(harness);
const parent = mkTmp('np-p-');
const seed = path.join(parent, 'brief.md');
write(seed, '# brief\n');

// --- happy path ---
const { target } = createProduct({ harnessRoot: harness, name: 'ridgo', parentDir: parent, seed });
const rd = (rel) => fs.readFileSync(path.join(target, rel), 'utf8');
const has = (rel) => fs.existsSync(path.join(target, rel));

check('target is <parent>/<name>', target === path.join(parent, 'ridgo'));
check('copies managed command', rd('.claude/commands/a.md') === 'a v1\n');
check('copies managed workflow', rd('.claude/workflows/w.js') === 'w v1\n');
check('renders {{NAME}} in CLAUDE.md', rd('CLAUDE.md') === '# ridgo\n');
check('gitignore.tmpl becomes .gitignore', rd('.gitignore') === 'node_modules/\n');
check('copies docs skeleton', has('docs/gates.json'));
check('creates docs dirs with .gitkeep', has('docs/adr/.gitkeep') && has('docs/ux/.gitkeep') && has('docs/brainstorm/.gitkeep'));
check('copies product settings with deny rule', /gh pr merge/.test(rd('.claude/settings.json')));
check('seeds the brief', rd('docs/brainstorm/brief.md') === '# brief\n');
check('git init ran', has('.git'));
check('no commit was made', (() => { try { git(['rev-parse', 'HEAD'], target); return false; } catch (e) { return true; } })());
check('no remote was created', git(['remote'], target).trim() === '');

const v = JSON.parse(rd('.claude/.harness-version'));
check('version file records managed hashes only',
  Object.keys(v.files).sort().join() === '.claude/commands/a.md,.claude/workflows/w.js');
check('version file records the harness version', v.harnessVersion === '1.0.0');
check('version file records commit "unknown" outside git', v.harnessCommit === 'unknown' && v.harnessDirty === false);
check('registers the product in the harness registry',
  readRegistry(harness).some((p) => p.name === 'ridgo' && p.path === target));

// --- Review Focus 3: personal / excluded files never copied ---
check('does not copy settings.local.json', !has('.claude/settings.local.json'));
check('does not copy manifest-excluded command', !has('.claude/commands/skip.md'));
check('does not copy the harness registry dir', !has('.harness'));
check('does not copy the manifest itself', !has('harness.manifest.json'));

// --- Review Focus 1: bad names write nothing ---
const before = fs.readdirSync(parent).sort().join();
for (const bad of ['Ridgo', 'my app', '../escape', 'a', '-x', 'foo-sync',
  'con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9', 'CON', 'Nul']) {
  check(`rejects name "${bad}"`, /invalid name/.test(throws(() => createProduct({ harnessRoot: harness, name: bad, parentDir: parent }))));
}
check('rejected names create nothing inside parent', fs.readdirSync(parent).sort().join() === before);
check('rejected names create nothing outside parent', !fs.existsSync(path.join(parent, '..', 'escape')));

// --- Review Focus 2: non-empty target refused, contents untouched ---
write(path.join(parent, 'busy', 'keep.txt'), 'x');
check('refuses a non-empty target',
  /not empty/.test(throws(() => createProduct({ harnessRoot: harness, name: 'busy', parentDir: parent }))));
check('leaves existing files alone', fs.readFileSync(path.join(parent, 'busy', 'keep.txt'), 'utf8') === 'x');
check('refusal did not copy anything in', !fs.existsSync(path.join(parent, 'busy', 'CLAUDE.md')));

// --- missing seed: error, nothing created ---
check('missing seed is an error',
  /seed file not found/.test(throws(() => createProduct({ harnessRoot: harness, name: 'noseed', parentDir: parent, seed: path.join(parent, 'nope.md') }))));
check('missing seed creates nothing', !fs.existsSync(path.join(parent, 'noseed')));

// --- a manifest without harnessVersion is refused before anything is written ---
const h5 = mkTmp('np-h5-');
makeFakeHarness(h5);
const m5 = JSON.parse(fs.readFileSync(path.join(h5, 'harness.manifest.json'), 'utf8'));
delete m5.harnessVersion;
write(path.join(h5, 'harness.manifest.json'), JSON.stringify(m5));
check('refuses a manifest without harnessVersion',
  /harnessVersion/.test(throws(() => createProduct({ harnessRoot: h5, name: 'nover', parentDir: parent, register: false }))));
check('and creates nothing', !fs.existsSync(path.join(parent, 'nover')));
rm(h5);

// --- a failure halfway leaves no half-built directory behind ---
const h6 = mkTmp('np-h6-');
makeFakeHarness(h6);
rm(path.join(h6, 'product-template')); // copying the template will throw
check('a failure halfway is reported', throws(() => createProduct({ harnessRoot: h6, name: 'broken', parentDir: parent, register: false })) !== '');
check('and no half-built directory is left behind', !fs.existsSync(path.join(parent, 'broken')));
rm(h6);

// --- real harness smoke test (register:false keeps the real registry clean) ---
const smoke = createProduct({ harnessRoot: REPO, name: 'smoke', parentDir: parent, register: false });
const sx = (rel) => fs.existsSync(path.join(smoke.target, rel));
check('real: pipeline command copied', sx('.claude/commands/explore.md'));
check('real: reviewer agent copied', sx('.claude/agents/reviewer.md'));
check('real: personal settings not copied', !sx('.claude/settings.local.json'));
check('real: interview-prep workflow not copied', !sx('.claude/workflows/study-research.js'));
check('real: deep-dive skill not copied', !sx('.claude/skills/deep-dive'));
check('real: version file carries the real harnessVersion',
  JSON.parse(fs.readFileSync(path.join(smoke.target, '.claude/.harness-version'), 'utf8')).harnessVersion === readManifest(REPO).harnessVersion);
check('real: registry untouched when register:false', !readRegistry(REPO).some((p) => p.name === 'smoke'));

// --- CLI ---
const CLI = path.join(__dirname, 'new-product.js');
function runCli(args) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
const ok = runCli(['cli-demo', '--dir', parent, '--harness-root', harness]);
check('CLI creates the product and exits 0', ok.code === 0 && fs.existsSync(path.join(parent, 'cli-demo', 'CLAUDE.md')));
check('CLI prints the created path', ok.out.includes(path.join(parent, 'cli-demo')));
check('CLI says no remote was created', /no remote/i.test(ok.out));
check('CLI registers into the harness it was given', readRegistry(harness).some((p) => p.name === 'cli-demo'));
const bad = runCli(['Bad Name', '--dir', parent, '--harness-root', harness]);
check('CLI exits 1 on an invalid name', bad.code === 1 && /new-product failed: invalid name/.test(bad.out));
const none = runCli(['--dir', parent, '--harness-root', harness]);
check('CLI exits 1 and prints usage without a name', none.code === 1 && /usage/i.test(none.out));

// --- H1: strict argument parsing (CLI copied into a fake harness: its default root is the fake one) ---
{
  const hs = mkTmp('np-hs-');
  const ps = mkTmp('np-ps-');
  const cw = mkTmp('np-cw-');
  makeFakeHarness(hs);
  installScripts(hs);
  const fakeCli = path.join(hs, 'scripts', 'new-product.js');
  const runFake = (args) => {
    try { return { code: 0, out: execFileSync('node', [fakeCli, ...args], { cwd: cw, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
    catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
  };
  const cases = [
    [['foo', '--dir'], /--dir requires a value/],
    [['foo', '--seed'], /--seed requires a value/],
    [['foo', '--harness-root'], /--harness-root requires a value/],
    [['foo', '--dir', '--seed', 'x.md'], /--dir requires a value/],
    [['foo', '--harness-root', '--dir', ps], /--harness-root requires a value/],
    [['foo', '--dir', ps, '--aply'], /unknown option --aply/],
    [['foo', '--dir', ps, '--inplace'], /unknown option --inplace/],
    [['foo', '--harness-root=' + hs, '--dir', ps], /unknown option --harness-root=/],
    [['foo', 'bar', '--dir', ps], /unexpected argument bar/],
  ];
  for (const [args, re] of cases) {
    const r = runFake(args);
    check('new-product CLI usage error for ' + args.join(' '), r.code === 1 && re.test(r.out));
  }
  check('usage errors write nothing',
    fs.readdirSync(ps).length === 0 && fs.readdirSync(cw).length === 0 && !fs.existsSync(path.join(hs, '.harness')) && !fs.existsSync(path.join(path.dirname(hs), 'foo')));
  const good = runFake(['foo', '--dir', ps]);
  check('valid input still works through the same CLI', good.code === 0 && fs.existsSync(path.join(ps, 'foo', 'CLAUDE.md')));
  rm(hs); rm(ps); rm(cw);
}

rm(harness);
rm(parent);
done('new-product');
