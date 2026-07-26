#!/usr/bin/env node
// check-harness.js — verify the .claude/ harness is intact.
// Usage: node scripts/check-harness.js [--root <dir>]
const fs = require('fs');
const path = require('path');

// All 8 pipeline stage commands.
const COMMANDS = ['explore', 'requirements', 'design', 'blueprint', 'breakdown', 'implement', 'fix-loop', 'deliver'];

function getRoot() {
  const i = process.argv.indexOf('--root');
  if (i !== -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.resolve(__dirname, '..');
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

  if (problems.length) {
    console.error('harness check FAILED:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('harness OK');
}

main();
