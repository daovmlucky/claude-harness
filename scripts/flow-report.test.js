// flow-report.test.js — fixtures that mimic Claude Code's workflow run records.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeChecker, mkTmp, write, rm } = require('./lib/testutil');
const rep = require('./lib/flow-report');
const { check, done } = makeChecker();

const usage = (i, o, r, c) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: r, cache_creation_input_tokens: c });
const line = (id, u) => JSON.stringify({ type: 'assistant', requestId: `req-${id}`, message: { id, usage: u } });

// A run with two agents. Agent "explore" has message m1 logged three times (streaming) and m2 once.
function buildRun(projectsRoot, repoPath, runId = 'wf_aaa111') {
  const dir = path.join(projectsRoot, rep.projectDirName(repoPath).toLowerCase(), 'session-1', 'subagents', 'workflows', runId);
  write(path.join(dir, 'journal.jsonl'), '{"type":"launched"}\n');
  write(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ description: 'explore', workflowPhase: 'Steps' }));
  write(path.join(dir, 'agent-a1.jsonl'), [
    line('m1', usage(1, 3, 100, 50)),
    line('m1', usage(1, 8, 100, 50)),
    line('m1', usage(1, 10, 100, 50)),
    line('m2', usage(2, 20, 300, 0)),
    'not json at all',
  ].join('\n') + '\n');
  write(path.join(dir, 'agent-a2.meta.json'), JSON.stringify({ description: 'save', workflowPhase: 'Save' }));
  write(path.join(dir, 'agent-a2.jsonl'), line('m9', usage(5, 7, 0, 40)) + '\n');
  return dir;
}

const root = mkTmp('fr-');
const repo = path.join(root, 'My Repo_1');
fs.mkdirSync(repo);
const projects = path.join(root, 'projects');
const runDir = buildRun(projects, repo);

check('projectDirName replaces every non-alphanumeric', rep.projectDirName('D:\\internal_project\\ridgo') === 'D--internal-project-ridgo');
check('findProjectDir matches case-insensitively', rep.findProjectDir(repo, projects).toLowerCase().endsWith(rep.projectDirName(repo).toLowerCase()));
let err = '';
try { rep.findProjectDir(path.join(root, 'nope'), projects); } catch (e) { err = e.message; }
check('findProjectDir explains a missing project', /no Claude Code project folder/.test(err));

const runs = rep.listRuns(rep.findProjectDir(repo, projects));
check('listRuns finds the run', runs.length === 1 && runs[0].runId === 'wf_aaa111');

const run = rep.readRun(runDir);
const explore = run.agents.find((a) => a.label === 'explore');
check('usage is counted once per message id', explore.calls === 2);
check('the last line of an id wins (final output count)', explore.output === 10 + 20);
check('input and cache columns sum over unique messages', explore.input === 3 && explore.cacheRead === 400 && explore.cacheCreation === 50);
check('phase comes from the meta file', explore.phase === 'Steps');
check('a malformed line is counted, not fatal', run.badLines === 1);

const sum = rep.summarize(run.agents);
check('totals add the agents', sum.total.output === 37 && sum.total.cacheRead === 400 && sum.total.cacheCreation === 90 && sum.total.calls === 3);
check('by-phase subtotals', sum.byPhase.Steps.output === 30 && sum.byPhase.Save.output === 7);

const text = rep.formatReport(run);
check('the report names the run and every agent', /wf_aaa111/.test(text) && /explore/.test(text) && /save/.test(text));
check('the report has a TOTAL line', /TOTAL/.test(text));
check('the report is ASCII', /^[\x20-\x7e\n]*$/.test(text));

// a folder that is not a run record
const empty = path.join(root, 'empty');
fs.mkdirSync(empty);
err = '';
try { rep.readRun(empty); } catch (e) { err = e.message; }
check('a folder without agent files is explained', /no agent-\*\.jsonl/.test(err) && /layout may have changed/.test(err));

// CLI
const CLI = path.join(__dirname, 'flow-report.js');
function cli(args) {
  try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8' }) }; }
  catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
}
let c = cli(['--project', repo, '--projects-dir', projects]);
check('CLI prints the newest run', c.code === 0 && /wf_aaa111/.test(c.out) && /TOTAL/.test(c.out));
c = cli(['--project', repo, '--projects-dir', projects, '--list']);
check('CLI --list lists runs', c.code === 0 && /wf_aaa111/.test(c.out) && /2 agents/.test(c.out));
c = cli(['--project', repo, '--projects-dir', projects, '--run', 'wf_zzz']);
check('CLI reports an unknown run', c.code === 1 && /wf_zzz/.test(c.out));
c = cli(['--project', repo, '--projects-dir', projects, '--run']);
check('CLI rejects an option without a value', c.code === 1 && /requires a value/.test(c.out));
c = cli(['--project', repo, '--bogus']);
check('CLI rejects an unknown option', c.code === 1 && /unknown option/.test(c.out));
c = cli(['--project', path.join(root, 'none'), '--projects-dir', projects]);
check('CLI reports a repo with no records', c.code === 1 && /no Claude Code project folder/.test(c.out));

// --append writes docs/flow-cost.md in the repo and keeps earlier entries
c = cli(['--project', repo, '--projects-dir', projects, '--append']);
const logFile = path.join(repo, 'docs', 'flow-cost.md');
check('CLI --append creates docs/flow-cost.md', c.code === 0 && fs.existsSync(logFile));
c = cli(['--project', repo, '--projects-dir', projects, '--append']);
const logText = fs.readFileSync(logFile, 'utf8');
check('a second --append adds another entry', (logText.match(/^## /gm) || []).length === 2 && /^# Flow cost log/.test(logText));

rm(root);
done('flow-report');
