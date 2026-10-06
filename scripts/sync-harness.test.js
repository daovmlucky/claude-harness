// sync-harness.test.js — sync planning/apply checks (spec 5.0, Review Focus 4, 6 and 7).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeChecker, mkTmp, write, rm, makeFakeHarness } = require('./lib/testutil');
const { createProduct } = require('./lib/create-product');
const { planSync, applySync, hasChanges, formatPlan, MajorVersionError } = require('./lib/sync');
const { sha256 } = require('./lib/fsutil');
const { check, done } = makeChecker();

function throws(fn) { try { fn(); return ''; } catch (e) { return e.message; } }

const harness = mkTmp('sy-h-');
makeFakeHarness(harness);
write(path.join(harness, '.claude/commands/old.md'), 'old\n');
write(path.join(harness, '.claude/commands/kept.md'), 'kept v1\n');
const parent = mkTmp('sy-p-');
const { target } = createProduct({ harnessRoot: harness, name: 'demo', parentDir: parent, register: false });
const prod = (rel) => path.join(target, rel);
const read = (rel) => fs.readFileSync(prod(rel), 'utf8');

// the harness evolves...
write(path.join(harness, '.claude/commands/a.md'), 'a v2\n');       // product untouched      -> update
write(path.join(harness, '.claude/workflows/w.js'), 'w v2\n');      // product edited too     -> conflict
write(path.join(harness, '.claude/commands/b.md'), 'b v1\n');       // brand new              -> add
fs.rmSync(path.join(harness, '.claude/commands/old.md'));           // dropped, untouched     -> remove
// ...and the product diverges
write(prod('.claude/workflows/w.js'), 'w mine\n');
write(prod('.claude/commands/kept.md'), 'kept mine\n');             // harness unchanged      -> kept

const plan = planSync(harness, target);
check('update for an untouched file', plan.update.join() === '.claude/commands/a.md');
check('add for a new harness file', plan.add.join() === '.claude/commands/b.md');
check('remove for a file the harness dropped', plan.remove.join() === '.claude/commands/old.md');
check('conflict for a file both sides changed', plan.conflict.join() === '.claude/workflows/w.js');
check('kept for a local edit when the harness did not change', plan.kept.join() === '.claude/commands/kept.md');
check('planSync alone writes nothing', read('.claude/commands/a.md') === 'a v1\n' && fs.existsSync(prod('.claude/commands/old.md')));
check('plan carries both versions', plan.versionFrom === '1.0.0' && plan.versionTo === '1.0.0');
check('hasChanges is true when files would change', hasChanges(plan));

const text = formatPlan('demo', plan);
check('formatPlan names the product and counts', /^demo \(1\.0\.0\): 1 add, 1 update, 1 remove, 1 conflict, 1 kept/.test(text));
check('formatPlan flags the conflict', /CONFLICT\s+\.claude\/workflows\/w\.js/.test(text));
check('formatPlan announces a new command', /new: \/b - see CHANGELOG/.test(text));

applySync(harness, target, plan);
check('apply performs update', read('.claude/commands/a.md') === 'a v2\n');
check('apply performs add', read('.claude/commands/b.md') === 'b v1\n');
check('apply performs remove', !fs.existsSync(prod('.claude/commands/old.md')));
check('apply never overwrites a conflicted file', read('.claude/workflows/w.js') === 'w mine\n');
check('apply never overwrites a kept file', read('.claude/commands/kept.md') === 'kept mine\n');

const again = planSync(harness, target);
check('second plan has nothing left to apply', again.add.length + again.update.length + again.remove.length === 0 && !hasChanges(again));
check('the conflict is still reported next time', again.conflict.join() === '.claude/workflows/w.js');
check('the kept file stays kept', again.kept.join() === '.claude/commands/kept.md');
check('an up-to-date product prints "up to date"', /up to date/.test(formatPlan('x', planSync(harness, createProduct({ harnessRoot: harness, name: 'fresh', parentDir: parent, register: false }).target))));

// the human resolves the conflict by taking the harness version
write(prod('.claude/workflows/w.js'), 'w v2\n');
const resolved = planSync(harness, target);
check('resolved conflict becomes current', resolved.conflict.length === 0 && resolved.current.includes('.claude/workflows/w.js'));
check('resolved conflict needs its record refreshed', resolved.refresh.includes('.claude/workflows/w.js') && hasChanges(resolved));
applySync(harness, target, resolved);
check('after resolving, a later harness change updates cleanly', (() => {
  write(path.join(harness, '.claude/workflows/w.js'), 'w v3\n');
  return planSync(harness, target).update.join() === '.claude/workflows/w.js';
})());
// put the harness back to what the product has, so later sections do not inherit a pending update
write(path.join(harness, '.claude/workflows/w.js'), 'w v2\n');

// a managed file the product deleted while the harness changed it is a conflict, not a silent re-add
fs.rmSync(prod('.claude/commands/b.md'));
write(path.join(harness, '.claude/commands/b.md'), 'b v2\n');
check('locally deleted + harness changed is a conflict', planSync(harness, target).conflict.includes('.claude/commands/b.md'));

// settings.json is the product's: only report missing deny rules, never write
check('no missing deny rules at first', planSync(harness, target).settingsMissing.length === 0);
const settingsBefore = '{"permissions":{"deny":["Bash(gh pr merge *)"]}}';
write(prod('.claude/settings.json'), settingsBefore);
check('reports a deny rule the product lacks', planSync(harness, target).settingsMissing.join() === 'Bash(git push -f *)');
check('formatPlan prints the missing deny rule', /settings: missing deny rule "Bash\(git push -f \*\)"/.test(formatPlan('demo', planSync(harness, target))));
applySync(harness, target, planSync(harness, target));
check('apply never writes settings.json', read('.claude/settings.json') === settingsBefore);

check('rejects a directory that is not a product repo',
  /\.harness-version/.test(throws(() => planSync(harness, parent))));

// a version file with a key that escapes the product directory is refused
const vf = prod('.claude/.harness-version');
const vOrig = fs.readFileSync(vf, 'utf8');
const vBad = JSON.parse(vOrig);
vBad.files['../evil.txt'] = 'x';
fs.writeFileSync(vf, JSON.stringify(vBad));
check('refuses a version file with an unsafe path', /unsafe path/.test(throws(() => planSync(harness, target))));
fs.writeFileSync(vf, vOrig);

function tamper(mutate) {
  const o = JSON.parse(vOrig);
  mutate(o);
  fs.writeFileSync(vf, JSON.stringify(o));
}
tamper((o) => { o.files['..\\evil.txt'] = 'x'; });
check('refuses a backslash path in the version file', /unsafe path/.test(throws(() => planSync(harness, target))));
fs.writeFileSync(vf, vOrig);
tamper((o) => { o.files['.claude/settings.json'] = 'x'; });
check('refuses settings.json as a recorded key', /unsafe path/.test(throws(() => planSync(harness, target))));
fs.writeFileSync(vf, vOrig);
tamper((o) => { o.files['.claude/.harness-version'] = 'x'; });
check('refuses the version file as a recorded key', /unsafe path/.test(throws(() => planSync(harness, target))));
fs.writeFileSync(vf, vOrig);
write(prod('docs/old.md'), 'doc\n');
tamper((o) => { o.files['docs/old.md'] = sha256(prod('docs/old.md')); });
let outside = null;
try { outside = planSync(harness, target); } catch (e) { outside = null; }
check('a recorded key outside .claude/ is a conflict, never a remove',
  outside !== null && outside.conflict.includes('docs/old.md') && !outside.remove.includes('docs/old.md'));
if (outside) applySync(harness, target, outside);
check('apply leaves a file outside .claude/ alone', fs.existsSync(prod('docs/old.md')));
rm(prod('docs/old.md'));
fs.writeFileSync(vf, vOrig);

// non-normalized spellings of protected files must be refused, not deleted
for (const key of ['.claude//settings.json', '.claude/./settings.json', '.claude//.harness-version', '.claude/./.harness-version']) {
  const real = key.includes('settings') ? '.claude/settings.json' : '.claude/.harness-version';
  const hash = sha256(prod(real));
  tamper((o) => { o.files[key] = hash; });
  check('refuses non-normalized key ' + key, /unsafe path/.test(throws(() => planSync(harness, target))));
  try { applySync(harness, target, planSync(harness, target)); } catch (e) { /* refusal expected */ }
  fs.writeFileSync(vf, vOrig);
  check('protected file survives ' + key, fs.existsSync(prod('.claude/settings.json')) && fs.existsSync(prod('.claude/.harness-version')));
}
for (const key of ['./.claude/settings.json', '.CLAUDE/settings.json', '.claude/commands/']) {
  tamper((o) => { o.files[key] = 'x'; });
  check('refuses key ' + key, /unsafe path/.test(throws(() => planSync(harness, target))));
  fs.writeFileSync(vf, vOrig);
}

// Windows path aliases (ADS, 8.3 short names) and unprotected personal files must never reach plan.remove
write(prod('.claude/settings.local.json'), '{"mine":true}');
for (const [key, real] of [
  ['.claude/settings.json::$DATA', '.claude/settings.json'],
  ['.claude/SETTIN~1.JSO', '.claude/settings.json'],
  ['.claude/settings.local.json', '.claude/settings.local.json'],
]) {
  write(prod(real), real.includes('local') ? '{"mine":true}' : settingsBefore); // the unfixed code deletes it, so recreate per key
  const hash = sha256(prod(real));
  tamper((o) => { o.files[key] = hash; });
  check('refuses alias key ' + key, /unsafe path/.test(throws(() => planSync(harness, target))));
  try { applySync(harness, target, planSync(harness, target)); } catch (e) { /* refusal expected */ }
  fs.writeFileSync(vf, vOrig);
  check('real file survives alias key ' + key, fs.existsSync(prod(real)));
}
// a plain, case-correct, unwanted file under .claude/ with a matching hash is still removable
write(prod('.claude/commands/extra.md'), 'extra\n');
tamper((o) => { o.files['.claude/commands/extra.md'] = sha256(prod('.claude/commands/extra.md')); });
check('a plain unwanted file under .claude/ is removable', planSync(harness, target).remove.includes('.claude/commands/extra.md'));
// a case-variant spelling of an existing file is never removed
fs.writeFileSync(vf, vOrig);
tamper((o) => { o.files['.claude/Commands/extra.md'] = sha256(prod('.claude/commands/extra.md')); });
{
  const pv = planSync(harness, target);
  check('a case-variant key is a conflict, never a remove',
    pv.conflict.includes('.claude/Commands/extra.md') && !pv.remove.includes('.claude/Commands/extra.md'));
}
fs.writeFileSync(vf, vOrig);
rm(prod('.claude/commands/extra.md'));
rm(prod('.claude/settings.local.json'));

// Review Focus 6: major jump refused (both directions), minor/patch accepted
const manifestPath = path.join(harness, 'harness.manifest.json');
const original = fs.readFileSync(manifestPath, 'utf8');
const m = JSON.parse(original);
m.harnessVersion = '2.0.0';
write(manifestPath, JSON.stringify(m));
let majorErr = null;
try { planSync(harness, target); } catch (e) { majorErr = e; }
check('refuses a major jump', majorErr instanceof MajorVersionError && /^major upgrade, not applied:/.test(majorErr.message));
check('the refusal names both versions', /1\.0\.0/.test(majorErr.message) && /2\.0\.0/.test(majorErr.message));
check('a major refusal writes nothing', read('.claude/workflows/w.js') === 'w v2\n');
m.harnessVersion = '1.4.2';
write(manifestPath, JSON.stringify(m));
const bumped = planSync(harness, target);
check('a minor/patch jump is planned', bumped.versionFrom === '1.0.0' && bumped.versionTo === '1.4.2' && hasChanges(bumped));
check('formatPlan shows the version change', /^demo \(1\.0\.0 -> 1\.4\.2\)/.test(formatPlan('demo', bumped)));
applySync(harness, target, bumped);
check('apply records the new harnessVersion', JSON.parse(read('.claude/.harness-version')).harnessVersion === '1.4.2');
m.harnessVersion = '0.9.0'; // product newer than harness is also a major mismatch
write(manifestPath, JSON.stringify(m));
check('refuses when the product is ahead of the harness', /major upgrade/.test(throws(() => planSync(harness, target))));
write(manifestPath, original);

// Review Focus 8: CRLF checkouts (autocrlf) must not look like local edits
{
  const h2 = mkTmp('sy-h2-');
  makeFakeHarness(h2);
  const p2 = mkTmp('sy-p2-');
  const t2 = createProduct({ harnessRoot: h2, name: 'crlf', parentDir: p2, register: false }).target;
  const files = ['.claude/commands/a.md', '.claude/workflows/w.js'];
  for (const f of files) {
    const fp = path.join(t2, f);
    fs.writeFileSync(fp, fs.readFileSync(fp, 'utf8').replace(/\n/g, '\r\n'));
  }
  const pc = planSync(h2, t2);
  check('CRLF product files are current', files.every((f) => pc.current.includes(f)));
  check('CRLF alone causes no change',
    [pc.conflict, pc.kept, pc.update, pc.add, pc.remove].every((a) => a.length === 0) && !hasChanges(pc));
  write(path.join(h2, '.claude/commands/a.md'), 'a changed\n');
  const pu = planSync(h2, t2);
  check('CRLF product file with a changed harness file is update, not conflict',
    pu.update.includes('.claude/commands/a.md') && !pu.conflict.includes('.claude/commands/a.md'));
  rm(h2);
  rm(p2);
}

// --- CLI: in-place mode, --all, registry (Review Focus 5) ---
const { registerProduct } = require('./lib/registry');
const CLI = path.join(__dirname, 'sync-harness.js');
function run(args) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
function commitAll(dir) {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' });
}
const gitIn = (dir, args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

const h2 = mkTmp('sy-h2-');
makeFakeHarness(h2);
const p2 = mkTmp('sy-p2-');
const cli = createProduct({ harnessRoot: h2, name: 'cli-demo', parentDir: p2 }).target; // registers in h2
registerProduct(h2, { name: 'ghost', path: path.join(p2, 'ghost') });                    // directory never created
const cliRead = (rel) => fs.readFileSync(path.join(cli, rel), 'utf8');

write(path.join(h2, '.claude/commands/a.md'), 'a v2\n');
write(path.join(h2, '.claude/commands/quality-check.md'), 'qc\n');
const dry = run([cli, '--harness-root', h2]);
check('dry run exits 0 and lists the update', dry.code === 0 && /update\s+\.claude\/commands\/a\.md/.test(dry.out));
check('dry run announces the new command', /new: \/quality-check - see CHANGELOG/.test(dry.out));
check('dry run says nothing was written', /dry run: nothing written/.test(dry.out));
check('dry run leaves the product untouched', cliRead('.claude/commands/a.md') === 'a v1\n');

// a minor release: version bump + changelog is shown to the human
const mp = path.join(h2, 'harness.manifest.json');
const mj = JSON.parse(fs.readFileSync(mp, 'utf8'));
mj.harnessVersion = '1.1.0';
write(mp, JSON.stringify(mj));
write(path.join(h2, 'CHANGELOG.md'), '# Changelog\n\n## 1.1.0\n- added quality check stage\n\n## 1.0.0\n- initial\n');
const minor = run([cli, '--harness-root', h2]);
check('dry run shows the version change', /cli-demo \(1\.0\.0 -> 1\.1\.0\)/.test(minor.out));
check('dry run prints the changelog entries in range', /changelog 1\.1\.0:/.test(minor.out) && /added quality check stage/.test(minor.out));
check('dry run does not print entries at or below the current version', !/changelog 1\.0\.0:/.test(minor.out));

const applied = run([cli, '--apply', '--in-place', '--harness-root', h2]);
check('--apply --in-place writes the update', applied.code === 0 && cliRead('.claude/commands/a.md') === 'a v2\n');
check('--in-place records the new version', JSON.parse(cliRead('.claude/.harness-version')).harnessVersion === '1.1.0');

write(path.join(h2, '.claude/commands/a.md'), 'a v3\n');
const allDry = run(['--all', '--harness-root', h2]);
check('--all names the processed product', allDry.code === 0 && /cli-demo \(1\.1\.0\): 1 update/.test(allDry.out));
check('--all warns about a missing directory and goes on', /WARN ghost: missing directory/.test(allDry.out));
const allInPlace = run(['--all', '--apply', '--in-place', '--harness-root', h2]);
check('--all --apply --in-place is refused and writes nothing',
  allInPlace.code === 1 && /sync failed: --in-place cannot be combined with --all/.test(allInPlace.out)
  && cliRead('.claude/commands/a.md') === 'a v2\n');

check('rejects a missing target argument', (() => { const r = run(['--harness-root', h2]); return r.code === 1 && /usage/i.test(r.out); })());
check('rejects a directory that is not a product', (() => { const r = run([p2, '--harness-root', h2]); return r.code === 1 && /\.harness-version/.test(r.out); })());

// Review Focus 5: corrupt registry -> clear error
write(path.join(h2, '.harness', 'products.json'), 'not json');
const corrupt = run(['--all', '--harness-root', h2]);
check('corrupt registry exits 1 with a clear message', corrupt.code === 1 && /not valid JSON/.test(corrupt.out));
rm(h2);
rm(p2);

// --- CLI: isolated worktree (Review Focus 7) ---
const h3 = mkTmp('sy-h3-');
const p3 = mkTmp('sy-p3-');
const h4 = mkTmp('sy-h4-');
const p4 = mkTmp('sy-p4-');
let wt;
try {
  makeFakeHarness(h3);
  wt = createProduct({ harnessRoot: h3, name: 'wt-demo', parentDir: p3, register: false }).target;
  commitAll(wt);
  const wtDir = path.join(p3, 'wt-demo-sync');
  const mainFile = (rel) => fs.readFileSync(path.join(wt, rel), 'utf8');
  write(path.join(h3, '.claude/commands/a.md'), 'a v2\n');

  const first = run([wt, '--apply', '--harness-root', h3]);
  check('--apply exits 0', first.code === 0);
  check('--apply leaves the product working directory untouched',
    mainFile('.claude/commands/a.md') === 'a v1\n' && gitIn(wt, ['status', '--porcelain']) === '');
  check('--apply writes into <product>-sync', fs.readFileSync(path.join(wtDir, '.claude/commands/a.md'), 'utf8') === 'a v2\n');
  check('--apply uses branch chore/harness-sync-v1.0.0', gitIn(wtDir, ['branch', '--show-current']) === 'chore/harness-sync-v1.0.0');
  check('--apply made no commit', gitIn(wtDir, ['rev-parse', 'HEAD']) === gitIn(wt, ['rev-parse', 'HEAD']));
  check('--apply tells the human how to review and clean up',
    /git -C .*diff/.test(first.out) && /git worktree remove/.test(first.out) && /between two stages/.test(first.out));

  write(path.join(h3, '.claude/commands/a.md'), 'a v3\n');
  const second = run([wt, '--apply', '--harness-root', h3]);
  check('a second --apply reuses the same worktree',
    second.code === 0 && fs.readFileSync(path.join(wtDir, '.claude/commands/a.md'), 'utf8') === 'a v3\n' && mainFile('.claude/commands/a.md') === 'a v1\n');

  // major jump: SKIPPED, exit 0, nothing written anywhere
  const m3 = JSON.parse(fs.readFileSync(path.join(h3, 'harness.manifest.json'), 'utf8'));
  m3.harnessVersion = '2.0.0';
  write(path.join(h3, 'harness.manifest.json'), JSON.stringify(m3));
  const skipped = run([wt, '--apply', '--harness-root', h3]);
  check('major jump is SKIPPED with exit 0', skipped.code === 0 && /SKIPPED wt-demo: major upgrade, not applied/.test(skipped.out));
  check('major jump writes nothing', fs.readFileSync(path.join(wtDir, '.claude/commands/a.md'), 'utf8') === 'a v3\n');

  // refusals: dirty .claude/ and no commits create no worktree
  makeFakeHarness(h4);
  const dirty = createProduct({ harnessRoot: h4, name: 'dirty-demo', parentDir: p4, register: false }).target;
  commitAll(dirty);
  // create the no-commit product BEFORE the harness changes, so that it is really up to date
  // and the only thing that can stop it is the missing commit
  const fresh = createProduct({ harnessRoot: h4, name: 'fresh-demo', parentDir: p4, register: false }).target;
  write(path.join(dirty, '.claude/workflows/w.js'), 'w local edit\n'); // uncommitted change under .claude/
  write(path.join(h4, '.claude/commands/a.md'), 'a v2\n');
  const dirtyRun = run([dirty, '--apply', '--harness-root', h4]);
  check('refuses when .claude/ has uncommitted changes', dirtyRun.code === 1 && /uncommitted changes under \.claude\//.test(dirtyRun.out));
  check('refusal creates no worktree', !fs.existsSync(path.join(p4, 'dirty-demo-sync')));
  const freshRun = run([fresh, '--apply', '--harness-root', h4]);
  check('refuses a product with no commits', freshRun.code === 1 && /no commits yet/.test(freshRun.out));
  check('no-commit refusal creates no worktree', !fs.existsSync(path.join(p4, 'fresh-demo-sync')));

  // a leftover branch from an earlier sync gets a clear message, not a raw git error
  execFileSync('git', ['worktree', 'remove', '--force', wtDir], { cwd: wt, stdio: 'ignore' });
  write(path.join(h3, 'harness.manifest.json'), JSON.stringify({ ...m3, harnessVersion: '1.0.0' }));
  write(path.join(h3, '.claude/commands/a.md'), 'a v4\n');
  const leftover = run([wt, '--apply', '--harness-root', h3]);
  check('a leftover sync branch is explained',
    leftover.code === 1 && /already exists from an earlier sync/.test(leftover.out) && /git branch -D/.test(leftover.out));
  check('the leftover-branch refusal creates no worktree', !fs.existsSync(wtDir));
} finally {
  for (const [repo, dir] of [[wt, path.join(p3, 'wt-demo-sync')]]) {
    if (repo) { try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: repo, stdio: 'ignore' }); } catch (e) { /* already gone */ } }
  }
  rm(h3); rm(p3); rm(h4); rm(p4);
}

// --- CLI: the worktree branches from main, not from whatever the product has checked out ---
{
  const h7 = mkTmp('sy-h7-');
  const p7 = mkTmp('sy-p7-');
  let prod7;
  try {
    makeFakeHarness(h7);
    prod7 = createProduct({ harnessRoot: h7, name: 'base-demo', parentDir: p7, register: false }).target;
    commitAll(prod7);
    const mainTip = gitIn(prod7, ['rev-parse', 'main']);
    gitIn(prod7, ['checkout', '-b', 'task/foo']);
    write(path.join(prod7, 'feature.txt'), 'feature work\n');
    commitAll(prod7);
    const featureTip = gitIn(prod7, ['rev-parse', 'HEAD']);
    write(path.join(h7, '.claude/commands/a.md'), 'a v2\n');
    const dir7 = path.join(p7, 'base-demo-sync');
    const r = run([prod7, '--apply', '--harness-root', h7]);
    check('--apply from a feature branch exits 0', r.code === 0);
    check('sync worktree starts at main, not at the checked-out feature branch',
      gitIn(dir7, ['rev-parse', 'HEAD']) === mainTip && gitIn(dir7, ['rev-parse', 'HEAD']) !== featureTip);
    check('sync worktree does not contain the feature commit', !fs.existsSync(path.join(dir7, 'feature.txt')));
    check('the CLI prints the base commit', r.out.includes(`base ${mainTip.slice(0, 7)}`));
    gitIn(prod7, ['worktree', 'remove', '--force', dir7]);
    gitIn(prod7, ['branch', '-D', 'chore/harness-sync-v1.0.0']);

    // no local main branch: clear error, nothing created
    gitIn(prod7, ['branch', '-m', 'main', 'trunk']);
    const nm = run([prod7, '--apply', '--harness-root', h7]);
    check('a product without a main branch is refused clearly', nm.code === 1 && /product has no "main" branch/.test(nm.out));
    check('the no-main refusal creates no worktree and no branch',
      !fs.existsSync(dir7) && gitIn(prod7, ['branch', '--list', 'chore/*']) === '');
  } finally {
    if (prod7) { try { execFileSync('git', ['worktree', 'remove', '--force', path.join(p7, 'base-demo-sync')], { cwd: prod7, stdio: 'ignore' }); } catch (e) { /* already gone */ } }
    rm(h7); rm(p7);
  }
}

// --- CLI: --all resilience, conflict-only exit code, reused-worktree conflicts ---
const h5 = mkTmp('sy-h5-');
const p5 = mkTmp('sy-p5-');
const h6 = mkTmp('sy-h6-');
const p6 = mkTmp('sy-p6-');
let real5;
try {
  makeFakeHarness(h5);
  registerProduct(h5, { name: 'ghost5', path: path.join(p5, 'ghost5') });        // directory never created
  const brokenDir = path.join(p5, 'broken5');
  fs.mkdirSync(brokenDir);                                                         // exists, not a product
  registerProduct(h5, { name: 'broken5', path: brokenDir });
  real5 = createProduct({ harnessRoot: h5, name: 'real5', parentDir: p5, register: false }).target;
  commitAll(real5);
  registerProduct(h5, { name: 'real5', path: real5 });
  write(path.join(h5, '.claude/commands/a.md'), 'a v2\n');

  const allD = run(['--all', '--harness-root', h5]);
  check('--all dry run keeps going past a ghost and a broken entry', /real5 \(1\.0\.0\): 1 update/.test(allD.out));
  check('--all dry run warns about the ghost', /WARN ghost5: missing directory/.test(allD.out));
  check('--all dry run reports the broken entry', /sync failed for broken5:/.test(allD.out));
  check('--all dry run exits 1 because of the broken entry', allD.code === 1);
  const allA = run(['--all', '--apply', '--harness-root', h5]);
  check('--all --apply still updates the real product in its worktree',
    fs.readFileSync(path.join(p5, 'real5-sync/.claude/commands/a.md'), 'utf8') === 'a v2\n'
    && fs.readFileSync(path.join(real5, '.claude/commands/a.md'), 'utf8') === 'a v1\n');
  check('--all --apply warns about the ghost and reports the broken entry',
    /WARN ghost5: missing directory/.test(allA.out) && /sync failed for broken5:/.test(allA.out));
  check('--all --apply exits 1 because of the broken entry', allA.code === 1);

  // a conflict alone is not an error
  makeFakeHarness(h6);
  const conf = createProduct({ harnessRoot: h6, name: 'conf6', parentDir: p6 }).target;
  write(path.join(conf, '.claude/commands/a.md'), 'product edit\n');
  write(path.join(h6, '.claude/commands/a.md'), 'a v2\n');
  const confRun = run(['--all', '--harness-root', h6]);
  check('a conflict alone exits 0', confRun.code === 0 && /CONFLICT \.claude\/commands\/a\.md/.test(confRun.out));

  // reused worktree: a human edit in <product>-sync shows up as a CONFLICT
  const wtA = path.join(p5, 'real5-sync/.claude/commands/a.md');
  write(wtA, 'human edit\n');
  write(path.join(h5, '.claude/commands/a.md'), 'a v3\n');
  const reuse = run([real5, '--apply', '--harness-root', h5]);
  check('reused worktree says it is reused', /reusing existing worktree/.test(reuse.out));
  check('reused worktree shows the CONFLICT instead of hiding it',
    /real5 \(worktree\)/.test(reuse.out) && /CONFLICT \.claude\/commands\/a\.md/.test(reuse.out));
  check('reused worktree keeps the human edit', fs.readFileSync(wtA, 'utf8') === 'human edit\n');
} finally {
  if (real5) {
    try { execFileSync('git', ['worktree', 'remove', '--force', path.join(p5, 'real5-sync')], { cwd: real5, stdio: 'ignore' }); } catch (e) { /* already gone */ }
  }
  rm(h5); rm(p5); rm(h6); rm(p6);
}

rm(harness);
rm(parent);
done('sync-core');
