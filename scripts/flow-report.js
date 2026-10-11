#!/usr/bin/env node
// flow-report.js — token usage of a workflow run, per agent and phase. Spends no tokens.
// Usage: node scripts/flow-report.js [--project <repo>] [--projects-dir <dir>] [--run wf_<id>] [--list] [--append]
//   --project defaults to the current directory; --projects-dir to ~/.claude/projects.
//   --append adds the report to <repo>/docs/flow-cost.md.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('./lib/args');
const rep = require('./lib/flow-report');

function main() {
  const usage = 'usage: flow-report.js [--project <repo>] [--projects-dir <dir>] [--run wf_<id>] [--list] [--append]';
  let a;
  try {
    a = parseArgs(process.argv.slice(2), { values: ['--project', '--projects-dir', '--run'], flags: ['--list', '--append'] });
    if (a.positional.length) throw new Error(`unexpected argument ${a.positional[0]}`);
  } catch (e) {
    console.error(`flow-report failed: ${e.message}\n${usage}`);
    process.exit(1);
  }
  const repo = path.resolve(a.values['--project'] || process.cwd());
  const projectsRoot = path.resolve(a.values['--projects-dir'] || path.join(os.homedir(), '.claude', 'projects'));
  try {
    const runs = rep.listRuns(rep.findProjectDir(repo, projectsRoot));
    if (!runs.length) throw new Error(`no workflow runs found for ${repo}`);
    if (a.flags.has('--list')) {
      for (const r of runs) {
        const n = fs.readdirSync(r.dir).filter((f) => /^agent-.*\.jsonl$/.test(f)).length;
        console.log(`${r.runId}  ${n} agents  ${new Date(r.mtimeMs).toISOString()}`);
      }
      return;
    }
    const wanted = a.values['--run'];
    const pick = wanted ? runs.find((r) => r.runId === wanted) : runs[0];
    if (!pick) throw new Error(`run ${wanted} not found; use --list to see the runs`);
    const text = rep.formatReport(rep.readRun(pick.dir));
    console.log(text);
    if (a.flags.has('--append')) {
      const file = path.join(repo, 'docs', 'flow-cost.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, '# Flow cost log\n\nTokens per workflow run, from scripts/flow-report.js.\n');
      fs.appendFileSync(file, `\n## ${new Date().toISOString().slice(0, 10)} ${pick.runId}\n\n\`\`\`\n${text}\n\`\`\`\n`);
      console.log(`appended to ${file}`);
    }
  } catch (e) {
    console.error(`flow-report failed: ${e.message}`);
    process.exit(1);
  }
}

main();
