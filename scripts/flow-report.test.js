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
  // a /flow run always starts with an agent labelled "state" (no usage lines here, so the totals below are unchanged)
  write(path.join(dir, 'agent-a3.meta.json'), JSON.stringify({ description: 'state', workflowPhase: 'State' }));
  write(path.join(dir, 'agent-a3.jsonl'), '');
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
check('CLI --list lists runs', c.code === 0 && /wf_aaa111/.test(c.out) && /3 agents/.test(c.out));
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

// Fix round 1: long, non-ASCII and multi-line labels (real ridgo labels are long Vietnamese text).
const longLabel = 'Ridgo v2 (ý tưởng chi tiết của founder) · market';
const longProjects = path.join(root, 'projects-long');
const longRepo = path.join(root, 'Long Repo');
fs.mkdirSync(longRepo);
const longRun = path.join(longProjects, rep.projectDirName(longRepo).toLowerCase(), 'session-2', 'subagents', 'workflows', 'wf_bbb222');
write(path.join(longRun, 'agent-b1.meta.json'), JSON.stringify({ description: longLabel, workflowPhase: 'Research (fan-out)' }));
write(path.join(longRun, 'agent-b1.jsonl'), line('n1', usage(1, 2, 3, 4)) + '\n');
// b2 differs from b1 only after character 40 of the label (the visible part is shorter than that)
write(path.join(longRun, 'agent-b2.meta.json'), JSON.stringify({ description: longLabel + ' beta', workflowPhase: 'Save' }));
write(path.join(longRun, 'agent-b2.jsonl'), line('n2', usage(1, 2, 3, 4)) + '\n');
write(path.join(longRun, 'agent-b3.meta.json'), JSON.stringify({ description: 'line one\n\tline two', workflowPhase: 'Save' }));
write(path.join(longRun, 'agent-b3.jsonl'), line('n3', usage(1, 2, 3, 4)) + '\n');

const longRuns = rep.readRun(longRun);
const longText = rep.formatReport(longRuns);
const ln = longText.split('\n');
check('(a) a long non-ASCII label gives an ASCII-only report', /^[\x20-\x7e\n]*$/.test(longText));
check('(a) the phase tag survives a long label', ln.some((l) => /\[Research \(fan-out\)\]\s+\d/.test(l)));
// Limit: the visible part of a label is short, so two labels that differ only after
// character 40 look alike; the phase tag is what keeps their rows apart.
check('(b) each agent row keeps its own phase tag', ln.filter((l) => / \[Save\]\s+\d/.test(l)).length === 2 && ln.filter((l) => /\[Research \(fan-out\)\]\s+\d/.test(l)).length === 1);
const expectLines = 2 + longRuns.agents.length + 1 + Object.keys(rep.summarize(longRuns.agents).byPhase).length + 1 + 1;
check('(c) a label with a newline and a tab adds no table lines', ln.length === expectLines);
check('(c) control characters in a label become spaces', longText.includes('line one line two'));
check('(d) the header separates output and cache_read', /output\s+cache_read/.test(longText));

c = cli(['--project', longRepo, '--projects-dir', longProjects, '--run', 'wf_bbb222', '--append']);
const longLog = fs.readFileSync(path.join(longRepo, 'docs', 'flow-cost.md'), 'utf8');
check('(e) --append writes ASCII only and the label text', c.code === 0 && /^[\x20-\x7e\n]*$/.test(longLog) && longLog.includes('line one line two') && /^[\x20-\x7e\n]*$/.test(c.out));

// M5: the default run is the newest /flow run (agents labelled "state" and "save"), not just the newest run
const mixRepo = path.join(root, 'Mixed Repo');
fs.mkdirSync(mixRepo);
const mixProjects = path.join(root, 'projects-mixed');
const mixWf = path.join(mixProjects, rep.projectDirName(mixRepo).toLowerCase(), 'session-3', 'subagents', 'workflows');
function mkRun(id, labels, ageSeconds) {
  const d = path.join(mixWf, id);
  labels.forEach((label, i) => {
    write(path.join(d, `agent-${i}.meta.json`), JSON.stringify({ description: label, workflowPhase: 'P' }));
    write(path.join(d, `agent-${i}.jsonl`), line(`${id}-${i}`, usage(1, 1, 1, 1)) + '\n');
  });
  const t = new Date(Date.UTC(2026, 0, 1) + (1000 - ageSeconds) * 1000);
  fs.utimesSync(d, t, t);
}
mkRun('wf_flowold', ['state', 'explore', 'save'], 500);
mkRun('wf_othernew', ['research', 'synthesize'], 10);
check('the fixture has the non-flow run as the newest', rep.listRuns(rep.findProjectDir(mixRepo, mixProjects))[0].runId === 'wf_othernew');
c = cli(['--project', mixRepo, '--projects-dir', mixProjects]);
check('M5: the default picks the newest /flow run', c.code === 0 && /wf_flowold/.test(c.out) && !/wf_othernew/.test(c.out));
c = cli(['--project', mixRepo, '--projects-dir', mixProjects, '--run', 'wf_othernew']);
check('M5: --run stays exact', c.code === 0 && /wf_othernew/.test(c.out));
c = cli(['--project', mixRepo, '--projects-dir', mixProjects, '--list']);
check('M5: --list still lists every run', c.code === 0 && /wf_flowold/.test(c.out) && /wf_othernew/.test(c.out));
const noFlowRepo = path.join(root, 'No Flow Repo');
fs.mkdirSync(noFlowRepo);
const noFlowProjects = path.join(root, 'projects-noflow');
const noFlowWf = path.join(noFlowProjects, rep.projectDirName(noFlowRepo).toLowerCase(), 'session-4', 'subagents', 'workflows', 'wf_plain');
write(path.join(noFlowWf, 'agent-0.meta.json'), JSON.stringify({ description: 'research', workflowPhase: 'P' }));
write(path.join(noFlowWf, 'agent-0.jsonl'), line('p0', usage(1, 1, 1, 1)) + '\n');
c = cli(['--project', noFlowRepo, '--projects-dir', noFlowProjects]);
check('M5: with only non-flow runs the default exits 1 with a hint', c.code === 1 && /no \/flow run found; use --list and --run wf_<id>/.test(c.out));
c = cli(['--project', noFlowRepo, '--projects-dir', noFlowProjects, '--run', 'wf_plain']);
check('M5: --run still reads a non-flow run', c.code === 0 && /wf_plain/.test(c.out));

// M6: the library source is pure ASCII (no raw combining characters)
const libBytes = fs.readFileSync(path.join(__dirname, 'lib', 'flow-report.js'));
check('M6: lib/flow-report.js has no byte above 126', libBytes.every((b) => b <= 126));
check('M6: the accent strip uses escapes', /\\u0300-\\u036f/.test(libBytes.toString('latin1')));

rm(root);
done('flow-report');
