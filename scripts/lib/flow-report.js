// flow-report.js — read Claude Code's workflow run records and total the token usage.
// Layout (internal to Claude Code, observed on 2.1.289):
//   <projects>/<project>/<session>/subagents/workflows/wf_<id>/agent-<id>.{jsonl,meta.json}
// Each API message is logged on several lines, so usage is counted once per message id.
const fs = require('fs');
const path = require('path');

const projectDirName = (repoPath) => path.resolve(repoPath).replace(/[^A-Za-z0-9]/g, '-');

function findProjectDir(repoPath, projectsRoot) {
  const want = projectDirName(repoPath).toLowerCase();
  const names = fs.existsSync(projectsRoot) ? fs.readdirSync(projectsRoot) : [];
  const hit = names.find((n) => n.toLowerCase() === want);
  if (!hit) throw new Error(`no Claude Code project folder for ${repoPath} under ${projectsRoot} (looked for ${want})`);
  return path.join(projectsRoot, hit);
}

function listRuns(projectDir) {
  const runs = [];
  for (const s of fs.readdirSync(projectDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const wf = path.join(projectDir, s.name, 'subagents', 'workflows');
    if (!fs.existsSync(wf)) continue;
    for (const r of fs.readdirSync(wf, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('wf_'))) {
      const dir = path.join(wf, r.name);
      runs.push({ runId: r.name, dir, mtimeMs: fs.statSync(dir).mtimeMs });
    }
  }
  return runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function readAgent(file) {
  const byId = new Map();
  let bad = 0;
  let anon = 0;
  for (const l of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    let o;
    try { o = JSON.parse(l); } catch (e) { bad++; continue; }
    const u = o.message && o.message.usage;
    if (!u) continue;
    byId.set((o.message && o.message.id) || o.requestId || `anon-${anon++}`, u);
  }
  const t = { calls: byId.size, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  for (const u of byId.values()) {
    t.input += u.input_tokens || 0;
    t.output += u.output_tokens || 0;
    t.cacheRead += u.cache_read_input_tokens || 0;
    t.cacheCreation += u.cache_creation_input_tokens || 0;
  }
  return { totals: t, bad };
}

function readRun(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^agent-.*\.jsonl$/.test(f));
  if (!files.length) {
    throw new Error(`no agent-*.jsonl files in ${dir}; this is not a workflow run record, or Claude Code's transcript layout may have changed`);
  }
  const agents = [];
  let badLines = 0;
  for (const f of files) {
    const metaFile = path.join(dir, f.replace(/\.jsonl$/, '.meta.json'));
    let meta = {};
    if (fs.existsSync(metaFile)) { try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) { meta = {}; } }
    const { totals, bad } = readAgent(path.join(dir, f));
    badLines += bad;
    agents.push({ label: meta.description || f.replace(/^agent-|\.jsonl$/g, ''), phase: meta.workflowPhase || '-', ...totals });
  }
  return { runId: path.basename(dir), agents, badLines };
}

const ZERO = () => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
function add(a, b) {
  for (const k of Object.keys(a)) a[k] += b[k];
}

function summarize(agents) {
  const total = ZERO();
  const byPhase = {};
  for (const a of agents) {
    add(total, a);
    byPhase[a.phase] = byPhase[a.phase] || ZERO();
    add(byPhase[a.phase], a);
  }
  return { total, byPhase };
}

const num = (n) => String(n).padStart(10);
function row(name, t) {
  return `${name.slice(0, 30).padEnd(31)}${String(t.calls).padStart(6)}${num(t.input)}${num(t.output)}${num(t.cacheRead)}${num(t.cacheCreation)}`;
}

function formatReport(run) {
  const { total, byPhase } = summarize(run.agents);
  const head = `${'agent'.padEnd(31)}${'calls'.padStart(6)}${'input'.padStart(10)}${'output'.padStart(10)}${'cache_read'.padStart(10)}${'cache_new'.padStart(10)}`;
  const lines = [`Run ${run.runId}`, head, ...run.agents.map((a) => row(`${a.label} [${a.phase}]`, a)), '-- by phase', ...Object.entries(byPhase).map(([p, t]) => row(p, t)), row('TOTAL', total)];
  if (run.badLines) lines.push(`(${run.badLines} unreadable line(s) skipped)`);
  lines.push('Tokens only; cache_read and cache_new (cache creation) are priced differently from input and output.');
  return lines.join('\n');
}

module.exports = { projectDirName, findProjectDir, listRuns, readRun, summarize, formatReport };
