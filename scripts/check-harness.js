#!/usr/bin/env node
// check-harness.js — verify the .claude/ harness is intact.
// Usage: node scripts/check-harness.js [--root <dir>]
const fs = require('fs');
const path = require('path');
const { readRegistry } = require('./lib/registry');
const { planSync, hasChanges, MajorVersionError } = require('./lib/sync');
const { parse, hasChangelogEntry } = require('./lib/version');

// All 8 pipeline stage commands.
const COMMANDS = ['explore', 'requirements', 'design', 'blueprint', 'breakdown', 'implement', 'fix-loop', 'deliver'];

function getRoot() {
  const i = process.argv.indexOf('--root');
  if (i !== -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.resolve(__dirname, '..');
}

// Informational only: product repos created from this harness that lag behind it.
function staleNotes(root) {
  try {
    return readRegistry(root)
      .filter((p) => fs.existsSync(p.path))
      .flatMap((p) => {
        try {
          const plan = planSync(root, p.path);
          if (!hasChanges(plan)) return [];
          const n = plan.add.length + plan.update.length + plan.remove.length + plan.refresh.length;
          const what = n ? `${n} file(s)` : 'version only';
          return [`${p.name}: behind harness ${plan.versionFrom} -> ${plan.versionTo} (${what}); run: node scripts/sync-harness.js "${p.path}"`];
        } catch (e) {
          if (e instanceof MajorVersionError) return [`${p.name}: ${e.message}`];
          throw e;
        }
      });
  } catch (e) {
    return [`could not check product repos: ${e.message}`];
  }
}

function main() {
  const root = getRoot();
  const problems = [];

  for (const c of COMMANDS) {
    const p = path.join(root, '.claude', 'commands', `${c}.md`);
    if (!fs.existsSync(p)) { problems.push(`missing command: .claude/commands/${c}.md`); continue; }
    if (!/description:/.test(fs.readFileSync(p, 'utf8'))) {
      problems.push(`command ${c}.md missing "description:"`);
    }
  }

  const reviewer = path.join(root, '.claude', 'agents', 'reviewer.md');
  if (!fs.existsSync(reviewer)) problems.push('missing agent: .claude/agents/reviewer.md');
  else {
    const txt = fs.readFileSync(reviewer, 'utf8');
    if (!txt.includes('REVIEW: PASS') || !txt.includes('REVIEW: BLOCK')) {
      problems.push('reviewer.md missing REVIEW: PASS/BLOCK contract');
    }
  }

  const skill = path.join(root, '.claude', 'skills', 'harness', 'SKILL.md');
  if (!fs.existsSync(skill)) problems.push('missing skill: .claude/skills/harness/SKILL.md');
  else if (!/name:\s*harness/.test(fs.readFileSync(skill, 'utf8'))) {
    problems.push('SKILL.md missing "name: harness"');
  }

  const manifestPath = path.join(root, 'harness.manifest.json');
  if (!fs.existsSync(manifestPath)) problems.push('missing harness.manifest.json');
  else {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { problems.push(`harness.manifest.json is not valid JSON: ${e.message}`); }
    if (manifest) {
      for (const m of manifest.managed || []) {
        if (!fs.existsSync(path.join(root, m))) problems.push(`manifest entry not found: ${m}`);
      }
      let versionOk = true;
      try { parse(manifest.harnessVersion); }
      catch (e) { versionOk = false; problems.push(`manifest harnessVersion invalid: ${e.message}`); }
      if (versionOk) {
        const cl = path.join(root, 'CHANGELOG.md');
        if (!fs.existsSync(cl)) problems.push('missing CHANGELOG.md');
        else if (!hasChangelogEntry(fs.readFileSync(cl, 'utf8'), manifest.harnessVersion)) {
          problems.push(`CHANGELOG.md has no entry for ${manifest.harnessVersion}`);
        }
      }
    }
  }

  const tplSettings = path.join(root, 'product-template', '.claude', 'settings.json');
  if (!fs.existsSync(tplSettings)) problems.push('missing product-template/.claude/settings.json');
  else {
    // parse the JSON: a merge rule sitting under "allow" or in a comment must not count
    let denyOk = false;
    try {
      denyOk = (JSON.parse(fs.readFileSync(tplSettings, 'utf8')).permissions.deny || []).some((r) => /gh pr merge/.test(r));
    } catch (e) { /* reported below */ }
    if (!denyOk) problems.push('product template settings.json must deny "gh pr merge"');
  }
  for (const t of ['CLAUDE.md.tmpl', path.join('docs', 'gates.json')]) {
    if (!fs.existsSync(path.join(root, 'product-template', t))) problems.push(`missing template file: product-template/${t}`);
  }

  if (problems.length) {
    console.error('harness check FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('harness OK');
  for (const n of staleNotes(root)) console.log(`note: ${n}`);
}

if (require.main === module) main();
module.exports = { staleNotes };
