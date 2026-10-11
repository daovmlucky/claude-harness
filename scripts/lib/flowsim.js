// flowsim.js — run .claude/workflows/flow.js outside Claude Code, against a scripted fake runtime.
// The script is evaluated inside a vm context with fake agent/parallel/log/phase/args globals.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FLOW = path.resolve(__dirname, '..', '..', '.claude', 'workflows', 'flow.js');
const STEPS = ['explore', 'requirements', 'design', 'blueprint', 'breakdown', 'implement', 'fix-loop', 'deliver'];
const TEST_PASS = { passed: true, command: 'npm test', summary: 'all green', failures: [] };
const REVIEW_PASS = { verdict: 'PASS', blockers: [] };
const DEFAULT_ARTIFACTS = { requirements: ['docs/spec.md'], breakdown: ['docs/plan.md'] };

function loadSource(file = FLOW) {
  const src = fs.readFileSync(file, 'utf8');
  if (!/^export const meta = \{/m.test(src)) throw new Error('flow.js must start with "export const meta = {"');
  return src.replace(/^export const meta = /m, 'const meta = ');
}

const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const stateJson = (o = {}) =>
  JSON.stringify({ flowSchema: 1, task: 'demo task', completed: [], approved: [], failure: '', ...o });

async function runFlow(args, respond, file) {
  const calls = [];
  const logs = [];
  const sandbox = {
    args,
    log: (m) => { logs.push(String(m)); },
    phase: () => {},
    agent: async (prompt, opts = {}) => {
      const call = { prompt, opts };
      calls.push(call);
      return respond(call, calls);
    },
    parallel: (thunks) => Promise.all(thunks.map(async (t) => { try { return await t(); } catch (e) { return null; } })),
    pipeline: () => { throw new Error('flow.js must not use pipeline'); },
    budget: { total: null, spent: () => 0, remaining: () => Infinity },
  };
  vm.createContext(sandbox);
  const value = await vm.runInContext(`(async () => {\n${loadSource(file)}\n})()`, sandbox);
  return { value, calls, logs };
}

function makeWorld(init = {}) {
  const w = {
    files: { ...(init.files || {}) },
    tests: [...(init.tests || [])],
    reviews: [...(init.reviews || [])],
    steps: init.steps || {},
    saveMissing: init.saveMissing || [],
    saves: [],
    reports: [],
  };
  w.respond = (call) => {
    const { label } = call.opts;
    if (label === 'state') {
      return { stateText: w.files['docs/flow-state.json'] || '', configText: w.files['docs/flow.config.json'] || '' };
    }
    if (label === 'save') {
      const m = /<<<STATE\n([\s\S]*?)\nSTATE>>>/.exec(call.prompt);
      const state = JSON.parse(m[1]);
      const r = /<<<REPORT\n([\s\S]*?)\nREPORT>>>/.exec(call.prompt);
      if (w.saveMissing.length) {
        // like the real save agent: write the ROLLBACK block of the earliest step whose required file is missing
        const step = STEPS.find((s) => (DEFAULT_ARTIFACTS[s] || []).some((p) => w.saveMissing.includes(p)));
        const rb = step && new RegExp(`<<<ROLLBACK ${step}\\n([\\s\\S]*?)\\nROLLBACK>>>`).exec(call.prompt);
        if (!rb) throw new Error(`no ROLLBACK block for step "${step}" in the save prompt`);
        const parsed = JSON.parse(rb[1]);
        w.files['docs/flow-state.json'] = rb[1];
        w.saves.push(parsed);
        return { savedCompleted: parsed.completed, failure: parsed.failure, missing: w.saveMissing };
      }
      w.files['docs/flow-state.json'] = m[1];
      w.saves.push(state);
      if (r) w.reports.push(r[1]);
      return { savedCompleted: state.completed, failure: state.failure, missing: [] };
    }
    if (/^fix-loop#\d+:test$/.test(label)) return w.tests.length ? w.tests.shift() : TEST_PASS;
    if (/^fix-loop#\d+:review$/.test(label)) return w.reviews.length ? w.reviews.shift() : REVIEW_PASS;
    if (/^fix-loop#\d+:fix$/.test(label)) return { summary: 'fixed', changed: ['src/x.js'] };
    if (w.steps[label]) return w.steps[label](call);
    return { status: 'done', summary: `${label} ok`, artifacts: DEFAULT_ARTIFACTS[label] || [] };
  };
  return w;
}

module.exports = { runFlow, makeWorld, plain, stateJson, TEST_PASS, REVIEW_PASS, STEPS };
