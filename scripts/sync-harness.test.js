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

rm(harness);
rm(parent);
done('sync-core');
