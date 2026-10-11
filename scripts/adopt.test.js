// adopt.test.js — bringing a repo that was not created by new-product.js under the sync.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeChecker, mkTmp, write, rm, makeFakeHarness } = require('./lib/testutil');
const { adoptProduct } = require('./lib/adopt');
const { planSync, hasChanges } = require('./lib/sync');
const { readRegistry } = require('./lib/registry');
const { check, done } = makeChecker();

const GIT = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (dir, args) => execFileSync('git', [...GIT, ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const throws = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
const CLI = path.join(__dirname, 'sync-harness.js');
function cli(args) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
function legacyRepo(parent, name, files, branch = 'master') {
  const dir = path.join(parent, name);
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', branch]);
  for (const [rel, text] of Object.entries(files)) write(path.join(dir, rel), text);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '--no-verify', '-m', 'init']);
  return dir;
}

const h = mkTmp('ad-h-');
makeFakeHarness(h); // manages .claude/commands/a.md ('a v1') and .claude/workflows/w.js ('w v1')
const p = mkTmp('ad-p-');
const created = [];
try {
  // --- an old repo: a.md identical, w.js edited, plus a personal settings file ---
  const legacy = legacyRepo(p, 'legacy', { '.claude/commands/a.md': 'a v1\n', '.claude/workflows/w.js': 'w mine\n', '.claude/settings.local.json': '{}' });
  const headBefore = git(legacy, ['rev-parse', 'HEAD']);
  const res = adoptProduct({ harnessRoot: h, productDir: legacy });
  const vf = path.join(legacy, '.claude', '.harness-version');
  const v = JSON.parse(fs.readFileSync(vf, 'utf8'));
  check('adopt reports the identical file', JSON.stringify(res.identical) === '["' + '.claude/commands/a.md' + '"]');
  check('adopt reports the differing file', JSON.stringify(res.differs) === '[".claude/workflows/w.js"]' && res.missing.length === 0);
  check('the version file records the harness version', v.harnessVersion === '1.0.0' && typeof v.syncedAt === 'string');
  check('only identical files are recorded', JSON.stringify(Object.keys(v.files)) === '[".claude/commands/a.md"]');
  check('the repo is registered with its resolved path', readRegistry(h).some((r) => r.name === 'legacy' && r.path === path.resolve(legacy)));
  check('adopt commits nothing', git(legacy, ['rev-parse', 'HEAD']) === headBefore);
  check('adopt writes exactly one new file', git(legacy, ['status', '--porcelain']) === '?? .claude/.harness-version');
  check('the differing file is untouched', fs.readFileSync(path.join(legacy, '.claude/workflows/w.js'), 'utf8') === 'w mine\n');
  const plan = planSync(h, legacy);
  check('after adopting, the identical file is current', plan.current.join() === '.claude/commands/a.md');
  check('the edited file is a conflict, never overwritten', plan.conflict.join() === '.claude/workflows/w.js' && plan.update.length === 0);
  check('an adopted, in-sync repo has nothing to apply', !hasChanges(plan));

  // --- a repo that lacks a managed file: the next sync adds it ---
  const missing = legacyRepo(p, 'missing', { '.claude/commands/a.md': 'a v1\n' });
  const res2 = adoptProduct({ harnessRoot: h, productDir: missing, register: false });
  check('a missing managed file is reported', res2.missing.join() === '.claude/workflows/w.js');
  check('the next sync would add it', planSync(h, missing).add.join() === '.claude/workflows/w.js');
  check('register:false leaves the registry alone', !readRegistry(h).some((r) => r.name === 'missing'));

  // --- refusals write nothing ---
  check('a missing directory is refused', /directory not found/.test(throws(() => adoptProduct({ harnessRoot: h, productDir: path.join(p, 'nope') }))));
  fs.mkdirSync(path.join(p, 'plain'));
  check('a folder without .claude is refused', /no \.claude\//.test(throws(() => adoptProduct({ harnessRoot: h, productDir: path.join(p, 'plain') }))));
  check('adopting twice is refused', /already adopted/.test(throws(() => adoptProduct({ harnessRoot: h, productDir: legacy }))));
  write(path.join(p, 'nogit', '.claude', 'commands', 'a.md'), 'a v1\n');
  check('a folder that is not a git repo is refused', /not a git repository/.test(throws(() => adoptProduct({ harnessRoot: h, productDir: path.join(p, 'nogit') }))));
  check('and gets no version file', !fs.existsSync(path.join(p, 'nogit', '.claude', '.harness-version')));
  const h2 = mkTmp('ad-h2-');
  makeFakeHarness(h2);
  const m = JSON.parse(fs.readFileSync(path.join(h2, 'harness.manifest.json'), 'utf8'));
  delete m.harnessVersion;
  write(path.join(h2, 'harness.manifest.json'), JSON.stringify(m));
  const other = legacyRepo(p, 'other', { '.claude/commands/a.md': 'a v1\n' });
  check('a harness without a version is refused', /harnessVersion/.test(throws(() => adoptProduct({ harnessRoot: h2, productDir: other, register: false }))));
  check('and the repo gets no version file', !fs.existsSync(path.join(other, '.claude', '.harness-version')));
  rm(h2);

  // --- the CLI end to end on a master-branch repo that lacks w.js ---
  const old = legacyRepo(p, 'old-repo', { '.claude/commands/a.md': 'a v1\n' });
  const oldSync = path.join(p, 'old-repo-sync');
  created.push([old, oldSync]);
  let r = cli(['--adopt', old, '--harness-root', h]);
  check('CLI --adopt succeeds and says what to do next', r.code === 0 && /adopted/.test(r.out) && /git -C .* add \.claude\/\.harness-version/.test(r.out) && /nothing was committed/.test(r.out));
  check('CLI --adopt registered the repo', readRegistry(h).some((x) => x.name === 'old-repo'));
  r = cli([old, '--harness-root', h]);
  check('a dry run now works and plans the missing file', r.code === 0 && /add\s+\.claude\/workflows\/w\.js/.test(r.out));
  r = cli([old, '--apply', '--harness-root', h]);
  check('--apply is refused until the version file is committed', r.code === 1 && /uncommitted changes under \.claude\//.test(r.out));
  git(old, ['add', '.claude/.harness-version']);
  git(old, ['commit', '-q', '--no-verify', '-m', 'chore: adopt harness sync']);
  r = cli([old, '--apply', '--harness-root', h]);
  check('after committing it, --apply works from master', r.code === 0 && fs.existsSync(oldSync) && /master/.test(r.out));
  check('the worktree got the missing file', fs.existsSync(path.join(oldSync, '.claude/workflows/w.js')));
  check('the repo itself was not touched', !fs.existsSync(path.join(old, '.claude/workflows/w.js')) && git(old, ['status', '--porcelain']) === '');
  check('the worktree is on the sync branch', git(oldSync, ['branch', '--show-current']) === 'chore/harness-sync-v1.0.0');

  // --- --base ---
  const trunk = legacyRepo(p, 'trunk-repo', { '.claude/commands/a.md': 'a v1\n' }, 'trunk');
  const trunkSync = path.join(p, 'trunk-repo-sync');
  created.push([trunk, trunkSync]);
  cli(['--adopt', trunk, '--harness-root', h]);
  git(trunk, ['add', '.claude/.harness-version']);
  git(trunk, ['commit', '-q', '--no-verify', '-m', 'adopt']);
  r = cli([trunk, '--apply', '--harness-root', h]);
  check('a branch that is neither main nor master is refused clearly', r.code === 1 && /product has no "main" branch \(and no "master"\)/.test(r.out) && /--base/.test(r.out));
  check('and creates no worktree', !fs.existsSync(trunkSync));
  r = cli([trunk, '--apply', '--base', 'nope', '--harness-root', h]);
  check('--base with an unknown branch is refused', r.code === 1 && /no "nope" branch/.test(r.out));
  r = cli([trunk, '--apply', '--base', '-x', '--harness-root', h]);
  check('--base with a suspicious name is refused', r.code === 1 && /invalid --base/.test(r.out));
  check('refused bases create no worktree', !fs.existsSync(trunkSync));
  r = cli([trunk, '--apply', '--base', 'trunk', '--harness-root', h]);
  check('--base trunk works and names the base', r.code === 0 && /\(base [0-9a-f]{7}, trunk\)/.test(r.out) && fs.existsSync(trunkSync));

  // --- a repo opts out of a managed file with .claude/harness.skip.json ---
  const skipRepo = legacyRepo(p, 'skip-repo', {
    '.claude/commands/a.md': 'a v1\n',
    '.claude/harness.skip.json': '{"skip":[".claude/workflows/w.js",".claude/workflows/typo.js"]}',
  });
  const sres = adoptProduct({ harnessRoot: h, productDir: skipRepo, register: false });
  check('adopt reports the skipped file, not as missing', sres.skipped.join() === '.claude/workflows/w.js' && sres.missing.length === 0);
  const sv = JSON.parse(fs.readFileSync(path.join(skipRepo, '.claude', '.harness-version'), 'utf8'));
  check('a skipped file is not recorded', JSON.stringify(Object.keys(sv.files)) === '[".claude/commands/a.md"]');
  const splan = planSync(h, skipRepo);
  check('a skipped file is never added', splan.add.length === 0 && !hasChanges(splan));
  check('the plan lists what was skipped', splan.skipped.join() === '.claude/workflows/w.js');
  check('a skip entry the harness does not manage is reported as a probable typo', splan.skipUnknown.join() === '.claude/workflows/typo.js');
  const { formatPlan } = require('./lib/sync');
  check('formatPlan prints the skipped file and the typo warning', /skipped\s+\.claude\/workflows\/w\.js/.test(formatPlan('x', splan)) && /WARN\s+skip entry \.claude\/workflows\/typo\.js/.test(formatPlan('x', splan)));

  // a file that was already recorded and present, then opted out of: no update, no conflict, no removal
  const optOut = legacyRepo(p, 'optout-repo', { '.claude/commands/a.md': 'a v1\n', '.claude/workflows/w.js': 'w v1\n' });
  adoptProduct({ harnessRoot: h, productDir: optOut, register: false });
  write(path.join(optOut, '.claude', 'harness.skip.json'), '{"skip":[".claude/workflows/w.js"]}');
  write(path.join(h, '.claude/workflows/w.js'), 'w v2\n'); // the harness changes the skipped file
  const oplan = planSync(h, optOut);
  check('an opted-out file is not updated and not a conflict', oplan.update.length === 0 && oplan.conflict.length === 0);
  check('and it is not removed', oplan.remove.length === 0);
  write(path.join(h, '.claude/workflows/w.js'), 'w v1\n'); // restore the shared fixture

  // an opt-out file removed from the harness manifest later must not delete the repo's copy
  const keep = legacyRepo(p, 'keep-repo', { '.claude/commands/a.md': 'a v1\n', '.claude/workflows/w.js': 'w v1\n' });
  adoptProduct({ harnessRoot: h, productDir: keep, register: false });
  write(path.join(keep, '.claude', 'harness.skip.json'), '{"skip":[".claude/workflows/gone.js"]}');
  check('a skip entry for a path the repo does not have changes nothing else', planSync(h, keep).conflict.length === 0);

  // bad skip files fail loudly, never silently ignore
  for (const [name, text, re] of [
    ['invalid JSON', '{nope', /not valid JSON/],
    ['an extra key', '{"skip":[],"also":1}', /only a "skip" list/],
    ['skip not a list', '{"skip":".claude/workflows/w.js"}', /must list relative paths/],
    ['a backslash path', '{"skip":[".claude\\\\workflows\\\\w.js"]}', /must list relative paths/],
    ['a .. path', '{"skip":["../x"]}', /must list relative paths/],
  ]) {
    write(path.join(keep, '.claude', 'harness.skip.json'), text);
    check(`a bad skip file is refused by planSync: ${name}`, re.test(throws(() => planSync(h, keep))));
  }
  const badAdopt = legacyRepo(p, 'badskip-repo', { '.claude/commands/a.md': 'a v1\n', '.claude/harness.skip.json': '{nope' });
  check('a bad skip file is refused by adopt, and nothing is written', /not valid JSON/.test(throws(() => adoptProduct({ harnessRoot: h, productDir: badAdopt, register: false }))) && !fs.existsSync(path.join(badAdopt, '.claude', '.harness-version')));

  // --- the skip list on the checked-out branch must match the base branch ---
  const mm = legacyRepo(p, 'mm-repo', { '.claude/commands/a.md': 'a v1\n' });
  const mmSync = path.join(p, 'mm-repo-sync');
  created.push([mm, mmSync]);
  cli(['--adopt', mm, '--harness-root', h]);
  git(mm, ['add', '.claude/.harness-version']);
  git(mm, ['commit', '-q', '--no-verify', '-m', 'adopt']);
  git(mm, ['checkout', '-q', '-b', 'task/x']);
  write(path.join(mm, '.claude', 'harness.skip.json'), '{"skip":[".claude/workflows/w.js"]}');
  git(mm, ['add', '.claude/harness.skip.json']);
  git(mm, ['commit', '-q', '--no-verify', '-m', 'skip on task branch only']);
  write(path.join(h, '.claude/commands/b.md'), 'b v1\n');
  r = cli([mm, '--harness-root', h]);
  check('the dry run honours the live skip list', r.code === 0 && /add\s+\.claude\/commands\/b\.md/.test(r.out) && /skipped\s+\.claude\/workflows\/w\.js/.test(r.out));
  r = cli([mm, '--apply', '--harness-root', h]);
  check('--apply refuses a skip list that differs from the base branch', r.code === 1 && /skip list on the base branch/.test(r.out));
  check('and leaves no worktree and no sync branch', !fs.existsSync(mmSync) && git(mm, ['branch', '--list', 'chore/*']) === '');
  git(mm, ['checkout', '-q', 'master']);
  git(mm, ['merge', '-q', '--no-verify', 'task/x']);
  r = cli([mm, '--apply', '--harness-root', h]);
  check('with the skip file on the base branch, --apply works', r.code === 0 && fs.existsSync(path.join(mmSync, '.claude/commands/b.md')));
  check('and the worktree does not get the skipped file', !fs.existsSync(path.join(mmSync, '.claude/workflows/w.js')));
  rm(path.join(h, '.claude/commands/b.md'));

  // --- the worktree is cut from the resolved SHA, not from a name a tag also uses ---
  const tg = legacyRepo(p, 'tag-repo', { '.claude/commands/a.md': 'a v1\n' }, 'trunk');
  const tgSync = path.join(p, 'tag-repo-sync');
  created.push([tg, tgSync]);
  git(tg, ['tag', 'trunk']);
  write(path.join(tg, 'extra.txt'), 'extra\n');
  git(tg, ['add', 'extra.txt']);
  git(tg, ['commit', '-q', '--no-verify', '-m', 'second']);
  cli(['--adopt', tg, '--harness-root', h]);
  git(tg, ['add', '.claude/.harness-version']);
  git(tg, ['commit', '-q', '--no-verify', '-m', 'adopt']);
  r = cli([tg, '--apply', '--base', 'trunk', '--harness-root', h]);
  check('--base works when a tag has the same name', r.code === 0 && fs.existsSync(tgSync));
  check('the worktree is cut from the branch tip, not the tag', git(tgSync, ['rev-parse', 'HEAD']) === git(tg, ['rev-parse', 'refs/heads/trunk']) && git(tgSync, ['rev-parse', 'HEAD']) !== git(tg, ['rev-parse', 'refs/tags/trunk^{commit}']));

  // --- option combinations ---
  for (const [name, args] of [
    ['--adopt with --all', ['--adopt', '--all']],
    ['--adopt with --apply', ['--adopt', old, '--apply']],
    ['--adopt with --in-place', ['--adopt', old, '--in-place']],
    ['--adopt with --base', ['--adopt', old, '--base', 'main']],
    ['--base with --all', ['--all', '--base', 'main']],
  ]) {
    r = cli([...args, '--harness-root', h]);
    check(`${name} is refused`, r.code === 1 && /cannot be combined/.test(r.out));
  }
  r = cli(['--adopt', '--harness-root', h]);
  check('--adopt without a repo is a usage error', r.code === 1 && /usage/i.test(r.out));
  r = cli(['--adopt', path.join(p, 'nope'), '--harness-root', h]);
  check('--adopt of a missing directory is reported', r.code === 1 && /directory not found/.test(r.out));
} finally {
  for (const [repo, wt] of created) {
    try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo, stdio: 'ignore' }); } catch (e) { /* not created */ }
  }
  rm(h);
  rm(p);
}
done('adopt');
