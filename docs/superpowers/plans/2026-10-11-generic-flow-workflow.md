# Generic `/flow` Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one generic workflow `/flow` in `claude-harness` that drives the existing 8-step harness pipeline up to the next human gate, plus a zero-token cost report, as harness version 1.1.0.

**Architecture:** `.claude/workflows/flow.js` is a thin skeleton (order of steps, gates, fix-loop, state). The content of each step is read by an agent from the existing `.claude/commands/<step>.md` files, so those files stay the single source of truth and are not modified. The script cannot read files, so one cheap agent returns the raw text of `docs/flow-state.json` and `docs/flow.config.json`; the script parses and validates them itself and a "Save" agent writes the state back from JSON the script computed. Control flow is tested without tokens by running the script inside Node `vm` against a scripted fake runtime.

**Tech Stack:** Node.js v20 (CommonJS, no dependencies) for scripts and tests; the workflow script itself is plain JavaScript run by Claude Code's Workflow runtime (no `import()`, no `Date.now()`/`Math.random()`/argless `new Date()`).

**Spec:** `docs/superpowers/specs/2026-10-11-generic-flow-workflow-design.md` (all sections). Runtime API reference: the `workflow-authoring` skill (`agent(prompt, {label, phase, schema, effort, model, agentType, isolation})`, `parallel(thunks)`, `log`, `args`).

## Global Constraints

- Plain Node CommonJS for `scripts/`, **no dependencies**; Node v20.15 on Windows; console strings ASCII only (spec: harness constraints).
- `flow.js` begins with `export const meta = { ... }` as a **pure literal**; it uses no `import()`, `Date.now`, `Math.random`, or argless `new Date()`; it uses `pipeline` nowhere (spec section 3).
- Existing files are **not modified**: `.claude/commands/*.md`, `.claude/skills/harness/SKILL.md`, `.claude/agents/reviewer.md`, `product-brainstorm.js`, `study-research.js` (spec section 1). The only existing files this plan edits are `package.json`, `scripts/check-harness.js`, `scripts/check-harness.test.js`, `harness.manifest.json`, `CHANGELOG.md`, `CLAUDE.md`, `product-template/CLAUDE.md.tmpl`.
- Required gates: `requirements` and `deliver`; no configuration can remove them; `docs/flow.config.json` may only **add** gates through `extraGates`, and unknown keys are an error (spec 4.2).
- State file `docs/flow-state.json`: `{"flowSchema":1,"task":"...","completed":[...],"approved":[...],"failure":""}`; `completed` is always the first N steps of the fixed order (spec 4.3).
- fix-loop: at most **5** rounds; green only if tests pass **and** the review verdict is `PASS` **and** there are no blockers; stop early when two consecutive rounds have the same failures and blockers; review agent uses `agentType: 'reviewer'` (spec 4.5).
- The workflow **never pushes, opens a pull request or merges**; every step prompt says so (spec 4.2).
- Cost-saving: `effort: 'low'` for the state, test and save agents; no `model` value is set (spec 4.6a). Agent labels are short and stable (`state`, `explore`, `fix-loop#2:review`, `save`) so the cost report can attribute tokens.
- Cost report counts **each API message once**: usage lines are deduplicated by `message.id` (last line wins) because each call is logged several times (spec 7a).
- Every commit ends with `-m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"` exactly; stage only the files a task names. The working tree holds the user's other uncommitted work (`README.md`, `.claude/commands/deep-dive.md`, `.claude/skills/deep-dive/`, `.claude/workflows/study-research.js`, `docs/deep-dives/`, `docs/brainstorm/`): never `git add -A` or `git add .`.
- Work happens on branch `feat/flow-workflow` (already created and checked out). Do not push.

## Deviations from the spec text (decided while planning)

1. `approved` in the state file is an **array** of step ids (spec 4.3 example was already updated to this).
2. A task description may not contain `<<<` or `>>>` (they delimit the payload given to the Save agent). Not in the spec; added as a guard.
3. `/flow start` with no text is a usage error; `/flow start <text>` forces a new task whose text may begin with `approve` or `status`.

## Review Focus

Failure modes the spec implies but no happy-path test exercises; each has a test in the task that owns the code:

1. A gate is added to `docs/flow.config.json` **after** that step already completed: `/flow` must refuse until the new gate is approved (Task 1, `pending gate`).
2. A task description with quotes, newlines or the delimiter text `<<<`/`>>>` must be saved intact or refused, never corrupt the saved JSON (Task 1 and Task 2).
3. `/flow approve Requirements` (different case) and `/flow approve login` (not a step) behave sensibly (Task 1).
4. An agent returns `null`, or a step result without the file the step must leave (`docs/spec.md`, `docs/plan.md`), or a Windows-style path (`docs\spec.md`): the flow must stop and say why, not mark the step done (Task 2).
5. A previous failure is recorded in the state: after a successful retry `failure` is cleared (Task 2).
6. In the fix-loop: tests green but review `BLOCK`; review `PASS` with a non-empty blockers list; a test or review agent that returns `null`; identical failures twice in a row; five rounds without green: none may reach `deliver` or report green (Task 3).
7. The usage report must not double count: five usage lines for one API message count once (Task 5).

---

## File Structure

```
.claude/workflows/flow.js            # the workflow (Tasks 1-3)
scripts/lib/flowsim.js               # runs flow.js in vm with a scripted fake runtime (Task 1)
scripts/flow.test.js                 # no-token tests of flow.js (Tasks 1-3)
scripts/check-harness.js (+ test)    # workflow lint, flow.js required (Task 4)
harness.manifest.json, CHANGELOG.md  # 1.1.0 (Task 4)
docs/flow.md, CLAUDE.md, product-template/CLAUDE.md.tmpl   # docs (Task 4)
scripts/lib/flow-report.js           # transcript reader and formatter (Task 5)
scripts/flow-report.js               # CLI (Task 5)
scripts/flow-report.test.js          # fixtures-based tests (Task 5)
package.json                         # test chain (Tasks 1, 5)
```

---

### Task 1: Test simulator, argument parsing, state and config validation, `status`, `approve`, refusals

**Files:**
- Create: `scripts/lib/flowsim.js`, `scripts/flow.test.js`, `.claude/workflows/flow.js`
- Modify: `package.json`

**Interfaces:**
- Produces (`flowsim.js`): `runFlow(args, respond, file?) -> Promise<{ value, calls, logs }>` where `respond(call, calls)` returns what each `agent()` call would return (`call = { prompt, opts }`); `makeWorld(init?) -> world` with `world.files`, `world.respond`, `world.saves` (parsed state JSON of every Save call), `world.reports` (fix-loop report texts), `world.saveMissing` (array; when non-empty the Save agent reports these missing paths), `world.tests`/`world.reviews` (queues for fix-loop agents), `world.steps` (label -> function returning a step result); constants `TEST_PASS`, `REVIEW_PASS`, `STEPS`; helpers `stateJson(overrides) -> string`, `plain(x)`.
- Produces (`flow.js`): returns `{ outcome, message, ... }` where `outcome` is one of `status | approved | refused | failed | gate | complete | escalated`. `runSegment(start, gates)` is a stub in this task (Task 2 replaces it).

- [ ] **Step 1: Write the simulator**

Create `scripts/lib/flowsim.js`:

```js
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
      if (w.saveMissing.length) return { savedCompleted: [], failure: 'a required file is missing', missing: w.saveMissing };
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
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/flow.test.js`:

```js
// flow.test.js — drives .claude/workflows/flow.js through a scripted fake runtime. Costs no tokens.
const { makeChecker } = require('./lib/testutil');
const { runFlow, makeWorld, plain, stateJson } = require('./lib/flowsim');
const { check, done } = makeChecker();
const ALL_CALLS = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function run(world, args) {
  const r = await runFlow(args, world.respond);
  ALL_CALLS.push(...r.calls);
  return { out: plain(r.value), calls: r.calls, labels: r.calls.map((c) => c.opts.label), logs: r.logs };
}
const withState = (o, extra = {}) => makeWorld({ files: { 'docs/flow-state.json': stateJson(o), ...extra } });

(async () => {
  let w;
  let r;

  // === SECTION: status ===
  w = makeWorld();
  r = await run(w, 'status');
  check('status without a task: outcome', r.out.outcome === 'status');
  check('status without a task: says how to start', /\/flow <description/.test(r.out.message));
  check('status calls only the state agent', same(r.labels, ['state']));

  w = withState({ completed: ['explore', 'requirements'] });
  r = await run(w, 'status');
  check('status shows the task', /demo task/.test(r.out.message));
  check('status shows the next step', /Next step: design/.test(r.out.message));
  check('status shows the pending gate', /\/flow approve requirements/.test(r.out.message));
  check('status shows the gates', /Gates: requirements, deliver/.test(r.out.message));
  check('status writes nothing', same(r.labels, ['state']) && w.saves.length === 0);

  w = withState({ completed: ['explore'], failure: 'design: boom' });
  r = await run(w, { cmd: 'status' });
  check('object args work and a past failure is shown', /Last failure: design: boom/.test(r.out.message));

  // === SECTION: continue refusals ===
  for (const a of [undefined, '', '   ']) {
    w = makeWorld();
    r = await run(w, a);
    check(`continue with no task is refused (${JSON.stringify(a)})`, r.out.outcome === 'refused' && /No task in progress/.test(r.out.message));
    check('refusal runs only the state agent', same(r.labels, ['state']));
  }
  w = withState({ completed: ['explore', 'requirements'] });
  r = await run(w, undefined);
  check('continue is refused while a gate is unapproved', r.out.outcome === 'refused' && /approve requirements/.test(r.out.message));
  check('that refusal runs nothing else', same(r.labels, ['state']) && w.saves.length === 0);

  // Review Focus 1: a gate added after its step already completed blocks until approved
  w = withState(
    { completed: ['explore', 'requirements', 'design'], approved: ['requirements'] },
    { 'docs/flow.config.json': '{"extraGates":["design"]}' },
  );
  r = await run(w, undefined);
  check('a gate added late blocks until approved', r.out.outcome === 'refused' && /approve design/.test(r.out.message));

  w = withState({ completed: STEPS_ALL(), approved: ['requirements', 'deliver'] });
  r = await run(w, undefined);
  check('a finished flow says it is complete', r.out.outcome === 'complete');

  // === SECTION: approve ===
  w = withState({ completed: ['explore', 'requirements'] });
  r = await run(w, 'approve requirements');
  check('approve records the gate', r.out.outcome === 'approved' && same(w.saves.at(-1).approved, ['requirements']));
  check('approve keeps completed unchanged', same(w.saves.at(-1).completed, ['explore', 'requirements']));
  check('approve uses only the state and save agents', same(r.labels, ['state', 'save']));
  check('approve says what to do next', /Continue with \/flow \(next step: design\)/.test(r.out.message));

  w = withState({ completed: ['explore', 'requirements'] });
  r = await run(w, 'approve Requirements');
  check('approve is case-insensitive', r.out.outcome === 'approved');

  w = withState({ completed: ['explore', 'requirements'], approved: ['requirements'] });
  r = await run(w, 'approve requirements');
  check('approving twice is a no-op', r.out.outcome === 'approved' && /already approved/.test(r.out.message) && w.saves.length === 0);

  w = withState({ completed: ['explore', 'requirements'] });
  r = await run(w, 'approve login');
  check('approve of an unknown step is refused', r.out.outcome === 'refused' && /Unknown step "login"/.test(r.out.message) && /\/flow start approve/.test(r.out.message));
  r = await run(w, 'approve');
  check('approve without a step is refused', r.out.outcome === 'refused' && /Usage: \/flow approve/.test(r.out.message));
  r = await run(w, 'approve design');
  check('approve of a non-gate is refused', r.out.outcome === 'refused' && /not a gate/.test(r.out.message));
  r = await run(w, 'approve deliver');
  check('approve of a gate not yet reached is refused', r.out.outcome === 'refused' && /not been completed/.test(r.out.message));
  check('refused approvals save nothing', w.saves.length === 0);
  w = makeWorld();
  r = await run(w, 'approve requirements');
  check('approve with no task is refused', r.out.outcome === 'refused' && /No task in progress/.test(r.out.message));

  w = withState({ completed: ['explore', 'requirements'] });
  w.saveMissing = ['docs/spec.md'];
  r = await run(w, 'approve requirements');
  check('approve fails if the save agent reports a missing required file', r.out.outcome === 'failed' && /docs\/spec\.md/.test(r.out.message));

  w = withState({ completed: STEPS_ALL(), approved: ['requirements'] });
  r = await run(w, 'approve deliver');
  check('approving deliver ends the flow and says nothing was pushed', r.out.outcome === 'approved' && /Nothing was pushed/.test(r.out.message));

  // === SECTION: corrupt state and config ===
  for (const [name, text, re] of [
    ['invalid JSON', '{nope', /not valid JSON/],
    ['wrong flowSchema', stateJson({ flowSchema: 2 }), /flowSchema/],
    ['completed not a prefix', stateJson({ completed: ['design'] }), /first steps in order/],
    ['unknown step id', stateJson({ completed: ['bogus'] }), /known step ids/],
    ['approved not completed', stateJson({ completed: ['explore'], approved: ['design'] }), /approved must list completed/],
    ['missing task', stateJson({ task: '' }), /task/],
    ['failure not a string', stateJson({ failure: 5 }), /failure must be a string/],
  ]) {
    w = makeWorld({ files: { 'docs/flow-state.json': text } });
    r = await run(w, 'status');
    check(`corrupt state is refused: ${name}`, r.out.outcome === 'refused' && re.test(r.out.message));
  }
  for (const [name, text, re] of [
    ['invalid JSON', '{nope', /not valid JSON/],
    ['not an object', '[]', /must be a JSON object/],
    ['tries to remove gates', '{"gates":[]}', /unknown key.*gates/],
    ['unknown step in extraGates', '{"extraGates":["bogus"]}', /extraGates must list/],
    ['extraGates not an array', '{"extraGates":"design"}', /extraGates must list/],
  ]) {
    w = makeWorld({ files: { 'docs/flow.config.json': text } });
    r = await run(w, 'status');
    check(`bad config is refused: ${name}`, r.out.outcome === 'refused' && re.test(r.out.message));
  }
  // status prints the gates only when a task exists, so these need a state file
  w = withState({}, { 'docs/flow.config.json': '{"extraGates":["design"]}' });
  r = await run(w, 'status');
  check('extraGates adds a gate and keeps the required ones in order', /Gates: requirements, design, deliver/.test(r.out.message));
  w = withState({}, { 'docs/flow.config.json': '{"extraGates":["deliver","requirements"]}' });
  r = await run(w, 'status');
  check('repeating a required gate changes nothing', /Gates: requirements, deliver$/m.test(r.out.message));

  w = makeWorld();
  w.respond = () => null;
  r = await run(w, 'status');
  check('a state agent that returns nothing is reported', r.out.outcome === 'failed' && /state agent did not return/.test(r.out.message));

  // === SECTION: start refusals ===
  w = makeWorld();
  r = await run(w, 'start');
  check('start without a task is refused', r.out.outcome === 'refused' && /Usage: \/flow <description/.test(r.out.message));
  r = await run(w, 'start do <<< things');
  check('a task containing the payload delimiters is refused', r.out.outcome === 'refused' && /<<</.test(r.out.message));
  r = await run(w, 'build >>> this');
  check('the delimiter guard also applies without the start word', r.out.outcome === 'refused');
  check('refused starts run only the state agent', r.labels.every((l) => l === 'state'));

  w = withState({ completed: ['explore'] });
  r = await run(w, 'build something else');
  check('starting while a task is in progress is refused', r.out.outcome === 'refused' && /already in progress \("demo task"\)/.test(r.out.message));
  w = withState({ completed: STEPS_ALL(), approved: ['requirements'] });
  r = await run(w, 'build something else');
  check('starting after a finished but unapproved delivery is refused', r.out.outcome === 'refused');
  w = withState({ completed: STEPS_ALL(), approved: ['requirements', 'deliver'] });
  r = await run(w, 'build something else');
  check('starting after a finished and approved task is allowed', r.out.outcome !== 'refused');

  // === SECTION: opts sanity ===
  const ALLOWED_OPTS = new Set(['label', 'phase', 'schema', 'effort', 'model', 'agentType']);
  const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
  check('every agent call has a label and a phase', ALL_CALLS.every((c) => c.opts.label && c.opts.phase));
  check('every agent call uses only documented options', ALL_CALLS.every((c) => Object.keys(c.opts).every((k) => ALLOWED_OPTS.has(k))));
  check('effort values are documented ones', ALL_CALLS.every((c) => c.opts.effort === undefined || EFFORTS.has(c.opts.effort)));
  check('every agent call asks for structured output', ALL_CALLS.every((c) => c.opts.schema && c.opts.schema.type === 'object'));
  check('schemas only require declared properties', ALL_CALLS.every((c) => (c.opts.schema.required || []).every((k) => k in c.opts.schema.properties)));
  check('only review calls pick an agentType', ALL_CALLS.every((c) => (c.opts.agentType === undefined) === !/:review$/.test(c.opts.label)));
  check('no model is hard-coded', ALL_CALLS.every((c) => c.opts.model === undefined));

  done('flow');
})().catch((e) => { console.error(e); process.exit(1); });

function STEPS_ALL() { return require('./lib/flowsim').STEPS.slice(); }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node scripts/flow.test.js`
Expected: FAIL — `ENOENT ... .claude\workflows\flow.js` (the workflow does not exist yet).

- [ ] **Step 4: Write `flow.js` (skeleton with validation, status, approve, refusals)**

Create `.claude/workflows/flow.js`:

```js
export const meta = {
  name: 'flow',
  description: 'Run the harness delivery flow (explore, requirements, design, blueprint, breakdown, implement, fix-loop, deliver) up to the next human approval gate, then stop.',
  whenToUse: 'Use /flow <task> to start, /flow to continue, /flow status to see where you are, /flow approve <step> to pass a gate.',
  phases: [
    { title: 'State', detail: 'read the flow state and config' },
    { title: 'Steps', detail: 'run the steps up to the next gate' },
    { title: 'Fix loop', detail: 'test and independent review, at most 5 rounds' },
    { title: 'Save', detail: 'write the flow state and the fix-loop record' },
  ],
};

// ---------------------------------------------------------------------------
// Generic delivery flow. Runs the harness pipeline up to the next human gate.
//   /flow <task>          start a new task
//   /flow                 continue the current task
//   /flow status          show where the task is (read only)
//   /flow approve <step>  record your approval of a gate
// The content of each step lives in .claude/commands/<step>.md; this script only
// owns the order, the gates, the fix-loop and the state. The script cannot read or
// write files: agents do, and the script parses and validates what they return.
// Date.now()/Math.random() are disabled in workflow scripts, so none are used.
// ---------------------------------------------------------------------------

const STEPS = ['explore', 'requirements', 'design', 'blueprint', 'breakdown', 'implement', 'fix-loop', 'deliver'];
const REQUIRED_GATES = ['requirements', 'deliver'];
const MAX_ROUNDS = 5;
const REQUIRED_ARTIFACTS = { requirements: ['docs/spec.md'], breakdown: ['docs/plan.md'] };
const NO_PUSH = 'Never push, never open a pull request and never merge.';

// Cost levers per kind of agent. Only `effort` is set; `model` is left to the
// session on purpose (valid model names are not verified). Edit to taste.
const TIERS = {
  state: { effort: 'low' },
  step: {},
  test: { effort: 'low' },
  review: {},
  fix: {},
  save: { effort: 'low' },
};

const STATE_FILES_SCHEMA = {
  type: 'object',
  properties: { stateText: { type: 'string' }, configText: { type: 'string' } },
  required: ['stateText', 'configText'],
};
const SAVE_SCHEMA = {
  type: 'object',
  properties: {
    savedCompleted: { type: 'array', items: { type: 'string' } },
    failure: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['savedCompleted', 'failure', 'missing'],
};

// ---- pure helpers -----------------------------------------------------------

const isStep = (s) => typeof s === 'string' && STEPS.includes(s);
const inOrder = (list) => STEPS.filter((s) => list.includes(s));
const gatesFor = (extra) => inOrder([...REQUIRED_GATES, ...extra]);
const pendingGate = (st, gates) => gates.find((g) => st.completed.includes(g) && !st.approved.includes(g));
const result = (outcome, message, extra = {}) => { log(message); return { outcome, message, ...extra }; };

function parseArgs(a) {
  if (a === undefined || a === null) return { cmd: 'continue' };
  if (typeof a === 'object') return { cmd: a.cmd || 'continue', task: a.task || '', step: String(a.step || '').toLowerCase() };
  const text = String(a).trim();
  if (text === '') return { cmd: 'continue' };
  if (text === 'status') return { cmd: 'status' };
  if (text === 'start') return { cmd: 'start', task: '' };
  const approveMatch = /^approve(?:\s+(\S+))?$/.exec(text);
  if (approveMatch) return { cmd: 'approve', step: (approveMatch[1] || '').toLowerCase() };
  const start = /^start\s+([\s\S]+)$/.exec(text);
  return { cmd: 'start', task: start ? start[1].trim() : text };
}

function parseState(text) {
  const bad = (error) => ({ exists: true, task: '', completed: [], approved: [], failure: '', error });
  if (!text || !text.trim()) return { exists: false, task: '', completed: [], approved: [], failure: '', error: '' };
  let o;
  try { o = JSON.parse(text); } catch (e) { return bad('docs/flow-state.json is not valid JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('docs/flow-state.json must be a JSON object');
  if (o.flowSchema !== 1) return bad(`docs/flow-state.json has flowSchema ${JSON.stringify(o.flowSchema)}, but this flow understands 1`);
  if (typeof o.task !== 'string' || o.task.trim() === '') return bad('docs/flow-state.json has no task');
  if (!Array.isArray(o.completed) || !o.completed.every(isStep)) return bad('docs/flow-state.json: completed must list known step ids');
  if (o.completed.some((s, i) => s !== STEPS[i])) return bad('docs/flow-state.json: completed must be the first steps in order');
  if (!Array.isArray(o.approved) || !o.approved.every((s) => isStep(s) && o.completed.includes(s))) {
    return bad('docs/flow-state.json: approved must list completed step ids');
  }
  if (typeof o.failure !== 'string') return bad('docs/flow-state.json: failure must be a string');
  return { exists: true, task: o.task, completed: o.completed, approved: o.approved, failure: o.failure, error: '' };
}

function parseConfig(text) {
  const bad = (error) => ({ extraGates: [], error });
  if (!text || !text.trim()) return { extraGates: [], error: '' };
  let o;
  try { o = JSON.parse(text); } catch (e) { return bad('docs/flow.config.json is not valid JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return bad('docs/flow.config.json must be a JSON object');
  const unknown = Object.keys(o).filter((k) => k !== 'extraGates');
  if (unknown.length) {
    return bad(`docs/flow.config.json has unknown key(s): ${unknown.join(', ')} (only "extraGates" is supported, and the required gates cannot be removed)`);
  }
  const extra = o.extraGates === undefined ? [] : o.extraGates;
  if (!Array.isArray(extra) || !extra.every(isStep)) return bad(`docs/flow.config.json: extraGates must list step ids from: ${STEPS.join(', ')}`);
  return { extraGates: extra, error: '' };
}

function describe(st, gates) {
  if (!st.exists) return 'No task in progress. Start one with: /flow <description of the task>';
  const pending = pendingGate(st, gates);
  const lines = [
    `Task: ${st.task}`,
    `Completed: ${st.completed.length ? st.completed.join(', ') : '(nothing yet)'}`,
    `Next step: ${STEPS[st.completed.length] || '(none, every step is done)'}`,
    `Gates: ${gates.join(', ')}`,
  ];
  if (pending) lines.push(`Waiting for your approval of "${pending}": run /flow approve ${pending}`);
  if (st.failure) lines.push(`Last failure: ${st.failure}`);
  return lines.join('\n');
}

function savePrompt(cur, report) {
  const stateJson = JSON.stringify(
    { flowSchema: 1, task: cur.task, completed: cur.completed, approved: cur.approved, failure: cur.failure },
    null,
    2,
  );
  const todo = [
    'Write the JSON between <<<STATE and STATE>>> to docs/flow-state.json exactly as given (create docs/ if it does not exist).',
    `For every step in "completed", check that its required file exists: ${JSON.stringify(REQUIRED_ARTIFACTS)}. If a file is missing, rewrite docs/flow-state.json without that step and without every step after it, set "failure" to a short reason that names the file, and list the missing paths in "missing".`,
  ];
  if (report) {
    todo.push('Put the text between <<<REPORT and REPORT>>> in docs/run-log.md under the heading "## Fix-loop (flow)", replacing the existing section with that heading if there is one.');
  }
  const parts = [
    'Save the state of the flow. Do exactly the numbered tasks and nothing else. Do not commit, do not push and do not change any other file.',
    ...todo.map((t, i) => `${i + 1}. ${t}`),
    'Return savedCompleted (the completed list you saved), failure (the failure text you saved, empty if none) and missing (the missing required paths, empty if none).',
    '<<<STATE',
    stateJson,
    'STATE>>>',
  ];
  if (report) parts.push('<<<REPORT', report, 'REPORT>>>');
  return parts.join('\n');
}

const STATE_PROMPT = [
  'Read two files in this repository and return their raw text. Do not create, change or delete any file.',
  '- docs/flow-state.json -> stateText (an empty string if the file does not exist)',
  '- docs/flow.config.json -> configText (an empty string if the file does not exist)',
  'Return the text exactly as stored, without commenting on it.',
].join('\n');

// ---- commands ---------------------------------------------------------------

async function approve(step, st, gates) {
  if (!step) return result('refused', 'Usage: /flow approve <step>');
  if (!isStep(step)) {
    return result('refused', `Unknown step "${step}". Steps: ${STEPS.join(', ')}. (To start a task whose description begins with the word approve, use: /flow start approve ...)`);
  }
  if (!st.exists) return result('refused', 'No task in progress. Start one with: /flow <description of the task>');
  if (!gates.includes(step)) return result('refused', `"${step}" is not a gate. Gates: ${gates.join(', ')}.`);
  if (!st.completed.includes(step)) return result('refused', `"${step}" has not been completed yet, so there is nothing to approve.`);
  if (st.approved.includes(step)) return result('approved', `"${step}" was already approved.`);
  const next = { task: st.task, completed: st.completed, approved: inOrder([...st.approved, step]), failure: st.failure };
  const saved = await agent(savePrompt(next, ''), { label: 'save', phase: 'Save', schema: SAVE_SCHEMA, ...TIERS.save });
  if (!saved) return result('failed', 'Could not save the approval: the save agent did not return. Nothing was recorded.');
  if (saved.missing.length) return result('failed', `Not approved: required file(s) missing: ${saved.missing.join(', ')}.`);
  const hint = step === 'deliver'
    ? 'The flow is complete. Nothing was pushed, opened or merged: do that yourself.'
    : `Continue with /flow (next step: ${STEPS[st.completed.length]}).`;
  return result('approved', `Approved "${step}". ${hint}`, { approved: next.approved });
}

// Task 2 replaces this stub with the step runner.
async function runSegment(start, gates) {
  return result('failed', 'Running steps is not implemented yet.', { completed: start.completed });
}

// ---- main -------------------------------------------------------------------

const cmd = parseArgs(args);
const files = await agent(STATE_PROMPT, { label: 'state', phase: 'State', schema: STATE_FILES_SCHEMA, ...TIERS.state });
if (!files) return result('failed', 'Could not read the flow state: the state agent did not return.');
const state = parseState(files.stateText);
const config = parseConfig(files.configText);
if (state.error) return result('refused', `${state.error}. Fix or delete docs/flow-state.json, then run /flow again.`);
if (config.error) return result('refused', `${config.error}.`);
const gates = gatesFor(config.extraGates);

if (cmd.cmd === 'status') return result('status', describe(state, gates));
if (cmd.cmd === 'approve') return await approve(cmd.step, state, gates);

if (cmd.cmd === 'start') {
  if (!cmd.task) return result('refused', 'Usage: /flow <description of the task>');
  if (/<<<|>>>/.test(cmd.task)) return result('refused', 'The task description must not contain "<<<" or ">>>".');
  const finished = state.exists && state.completed.length === STEPS.length && state.approved.includes('deliver');
  if (state.exists && !finished) {
    return result('refused', `A task is already in progress ("${state.task}"). Finish it with /flow, or abandon it by deleting docs/flow-state.json.`);
  }
  return await runSegment({ task: cmd.task, completed: [], approved: [] }, gates);
}

if (cmd.cmd !== 'continue') {
  return result('refused', `Unknown command "${cmd.cmd}". Use: /flow <task> | /flow | /flow status | /flow approve <step>`);
}
if (!state.exists) return result('refused', 'No task in progress. Start one with: /flow <description of the task>');
const pending = pendingGate(state, gates);
if (pending) return result('refused', `Waiting for your approval of "${pending}". Review the output, then run: /flow approve ${pending}`);
if (state.completed.length === STEPS.length) return result('complete', 'Every step is done and approved. Start a new task with: /flow <description of the task>');
return await runSegment(state, gates);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node scripts/flow.test.js`
Expected: `PASS (flow)` with no `FAIL:` lines.

- [ ] **Step 6: Add the tests to `npm test`**

Edit `package.json`: append ` && node scripts/flow.test.js` to the `"test"` value (keep the existing chain).
Run: `npm test`
Expected: five `PASS` lines ending with `PASS (flow)`.

- [ ] **Step 7: Commit**

```bash
rtk git add .claude/workflows/flow.js scripts/lib/flowsim.js scripts/flow.test.js package.json
rtk git commit -m "feat: add the /flow workflow skeleton with state, status and approve" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Step runner (everything except the fix-loop)

**Files:**
- Modify: `.claude/workflows/flow.js` (replace the `runSegment` stub; add `stepPrompt`, `stepProblem`, `normalizePath`, `STEP_SCHEMA`), `scripts/flow.test.js`

**Interfaces:**
- Consumes (Task 1): `savePrompt(cur, report)`, `SAVE_SCHEMA`, `TIERS`, `gates`, `result`, `makeWorld`, `run`, `withState`.
- Produces: `runSegment(start, gates)` returning `{ outcome: 'gate' | 'failed', message, completed, failure }`; step agents are labeled with the step id (`explore`, `requirements`, ...), phase `Steps`.

- [ ] **Step 1: Write the failing tests**

In `scripts/flow.test.js`, insert the following immediately above the line `// === SECTION: opts sanity ===`:

```js
  // === SECTION: run to the first gate ===
  w = makeWorld();
  r = await run(w, 'build a login page');
  check('start runs explore and requirements, then saves', same(r.labels, ['state', 'explore', 'requirements', 'save']));
  check('start stops at the requirements gate', r.out.outcome === 'gate' && /approve requirements/.test(r.out.message));
  check('start saves the task and progress', same(w.saves.at(-1), { flowSchema: 1, task: 'build a login page', completed: ['explore', 'requirements'], approved: [], failure: '' }));
  check('the run does not go past the gate', !r.labels.includes('design'));

  // every step prompt: reads its command file, ignores the interactive stops, never pushes
  check('every step prompt names its command file', ['explore', 'requirements'].every((s) => r.calls.find((c) => c.opts.label === s).prompt.includes(`.claude/commands/${s}.md`)));
  check('every step prompt says not to stop and ask', r.calls.filter((c) => STEPS_ALL().includes(c.opts.label)).every((c) => /do NOT stop to ask the user/.test(c.prompt)));
  check('every step prompt forbids push, PR and merge', r.calls.filter((c) => STEPS_ALL().includes(c.opts.label)).every((c) => /Never push, never open a pull request and never merge\./.test(c.prompt)));
  check('every step prompt carries the task', r.calls.filter((c) => STEPS_ALL().includes(c.opts.label)).every((c) => c.prompt.includes('Task: build a login page')));
  check('step agents run in the Steps phase', r.calls.filter((c) => STEPS_ALL().includes(c.opts.label)).every((c) => c.opts.phase === 'Steps'));

  // Review Focus 2: awkward task text is saved intact
  const odd = 'fix "quotes", a\nnew line and a backslash \\ ok';
  w = makeWorld();
  r = await run(w, odd);
  check('a task with quotes, newlines and a backslash is saved intact', w.saves.at(-1).task === odd);

  // continue after approval, with an extra gate after design
  w = makeWorld({ files: { 'docs/flow.config.json': '{"extraGates":["design"]}' } });
  await run(w, 'build something');
  r = await run(w, 'approve requirements');
  r = await run(w, undefined);
  check('with extraGates the run stops after design', same(r.labels, ['state', 'design', 'save']) && r.out.outcome === 'gate' && /approve design/.test(r.out.message));
  check('and progress is saved', same(w.saves.at(-1).completed, ['explore', 'requirements', 'design']));
  r = await run(w, undefined);
  check('the extra gate blocks until approved', r.out.outcome === 'refused' && /approve design/.test(r.out.message));
  await run(w, 'approve design');
  r = await run(w, undefined);
  check('after approving it the run continues with blueprint', r.labels[1] === 'blueprint');

  // continue to the delivery gate (starting from implement is done after the fix-loop exists; here start at deliver)
  w = withState({ completed: STEPS_ALL().slice(0, 7), approved: ['requirements'] });
  r = await run(w, undefined);
  check('deliver stops at the release gate', same(r.labels, ['state', 'deliver', 'save']) && r.out.outcome === 'gate' && /approve deliver/.test(r.out.message));

  // failures
  w = makeWorld({ steps: { design: () => ({ status: 'failed', summary: 'boom', artifacts: [] }) } });
  w.files['docs/flow-state.json'] = stateJson({ completed: ['explore', 'requirements'], approved: ['requirements'] });
  r = await run(w, undefined);
  check('a failed step stops the run', r.out.outcome === 'failed' && !r.labels.includes('blueprint'));
  check('the failure names the step and the reason', /design: the agent reported failure: boom/.test(w.saves.at(-1).failure));
  check('progress before the failure is kept', same(w.saves.at(-1).completed, ['explore', 'requirements']));
  check('the message says where to retry', /retry from "design"/.test(r.out.message));

  w = makeWorld({ steps: { design: () => null } });
  w.files['docs/flow-state.json'] = stateJson({ completed: ['explore', 'requirements'], approved: ['requirements'] });
  r = await run(w, undefined);
  check('an agent that returns nothing is a failure', r.out.outcome === 'failed' && /did not return a result/.test(w.saves.at(-1).failure));

  // Review Focus 5: a retry that succeeds clears the failure
  w = makeWorld();
  w.files['docs/flow-state.json'] = stateJson({ completed: ['explore', 'requirements'], approved: ['requirements'], failure: 'design: boom' });
  r = await run(w, undefined);
  check('a successful retry clears the old failure', w.saves.at(-1).failure === '' && w.saves.at(-1).completed.includes('design'));

  // Review Focus 4: required files
  w = makeWorld({ steps: { requirements: () => ({ status: 'done', summary: 'ok', artifacts: [] }) } });
  r = await run(w, 'build x');
  check('requirements must report docs/spec.md', r.out.outcome === 'failed' && /did not report writing docs\/spec\.md/.test(w.saves.at(-1).failure));
  check('and is then not recorded as completed', same(w.saves.at(-1).completed, ['explore']));
  w = makeWorld({ steps: { requirements: () => ({ status: 'done', summary: 'ok', artifacts: ['docs\\spec.md'] }) } });
  r = await run(w, 'build x');
  check('a Windows path to docs/spec.md is accepted', r.out.outcome === 'gate');
  w = makeWorld({ steps: { requirements: () => ({ status: 'done', summary: 'ok', artifacts: ['./docs/spec.md'] }) } });
  r = await run(w, 'build x');
  check('a ./ path to docs/spec.md is accepted', r.out.outcome === 'gate');
  w = makeWorld({ steps: { breakdown: () => ({ status: 'done', summary: 'ok', artifacts: ['docs/other.md'] }) } });
  w.files['docs/flow-state.json'] = stateJson({ completed: ['explore', 'requirements', 'design', 'blueprint'], approved: ['requirements'] });
  r = await run(w, undefined);
  check('breakdown must report docs/plan.md', r.out.outcome === 'failed' && /did not report writing docs\/plan\.md/.test(w.saves.at(-1).failure));
  check('implement does not run after a breakdown failure', !r.labels.includes('implement'));

  // the save agent finds a missing required file
  w = makeWorld();
  w.saveMissing = ['docs/spec.md'];
  r = await run(w, 'build x');
  check('a required file missing at save time is a failure', r.out.outcome === 'failed' && /docs\/spec\.md/.test(r.out.message));

  w = makeWorld();
  const respond = w.respond;
  w.respond = (call) => (call.opts.label === 'save' ? null : respond(call));
  r = await run(w, 'build x');
  check('a save agent that returns nothing is reported', r.out.outcome === 'failed' && /could not be saved/.test(r.out.message));

```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/flow.test.js`
Expected: FAIL lines such as `FAIL: start runs explore and requirements, then saves` (the stub returns "not implemented").

- [ ] **Step 3: Implement the step runner**

In `.claude/workflows/flow.js`, add `STEP_SCHEMA` directly after `SAVE_SCHEMA`:

```js
const STEP_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    summary: { type: 'string' },
    artifacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'artifacts'],
};
```

Add these helpers directly above the `// ---- commands` line:

```js
const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

function stepPrompt(step, task) {
  return [
    `You are running the "${step}" step of the harness delivery flow.`,
    `Task: ${task}`,
    '',
    `1. Read .claude/commands/${step}.md. It is the instruction for this step. Follow it exactly, and use the task above wherever it refers to $ARGUMENTS.`,
    '2. A workflow runs the human approval gates itself. So do NOT stop to ask the user anything, do NOT wait for approval, and ignore any line that tells you to stop, to ask the user to approve, or to suggest running another command.',
    `3. ${NO_PUSH} Commit only if the step file asks you to, and only on a feature branch.`,
    '4. If docs/run-log.md already has a section for this step, replace it instead of adding a duplicate.',
    '5. Report through the structured result: status "done" (or "failed", with the reason in summary), a one-line summary, and artifacts = the repo-relative paths of the files you wrote or changed. List a path only if the file exists.',
  ].join('\n');
}

function stepProblem(step, out) {
  if (!out) return 'the agent did not return a result';
  if (out.status !== 'done') return `the agent reported failure: ${out.summary}`;
  const reported = (out.artifacts || []).map(normalizePath);
  const missing = (REQUIRED_ARTIFACTS[step] || []).filter((p) => !reported.includes(p));
  if (missing.length) return `the agent did not report writing ${missing.join(', ')}`;
  return '';
}
```

Replace the whole `runSegment` stub (the comment line `// Task 2 replaces this stub...` and the function) with:

```js
async function runSegment(start, gates) {
  const cur = { task: start.task, completed: [...start.completed], approved: [...start.approved], failure: '' };
  const reports = [];
  let outcome = 'gate';
  for (const step of STEPS.slice(cur.completed.length)) {
    log(`Running step: ${step}`);
    const out = await agent(stepPrompt(step, cur.task), { label: step, phase: 'Steps', schema: STEP_SCHEMA, ...TIERS.step });
    const problem = stepProblem(step, out);
    if (problem) {
      cur.failure = `${step}: ${problem}`;
      outcome = 'failed';
      break;
    }
    cur.completed.push(step);
    if (gates.includes(step)) break;
  }

  const saved = await agent(savePrompt(cur, reports.join('\n')), { label: 'save', phase: 'Save', schema: SAVE_SCHEMA, ...TIERS.save });
  if (!saved) {
    return result('failed', 'The steps ran, but docs/flow-state.json could not be saved (the save agent did not return). Check docs/ before running /flow again.', { completed: cur.completed });
  }
  const done = saved.savedCompleted;
  const retry = STEPS[done.length];
  if (saved.missing.length) {
    return result('failed', `Required file(s) missing: ${saved.missing.join(', ')}. ${saved.failure} Run /flow to retry from "${retry}".`, { completed: done, failure: saved.failure });
  }
  if (outcome === 'failed') {
    return result('failed', `Stopped: ${cur.failure}. Fix the cause, then run /flow to retry from "${retry}".`, { completed: done, failure: cur.failure });
  }
  const last = done[done.length - 1];
  return result('gate', `Stopped at the "${last}" gate. Review the result, then run: /flow approve ${last}`, { completed: done });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/flow.test.js`
Expected: `PASS (flow)`. Then `npm test` — all suites `PASS`.

- [ ] **Step 5: Commit**

```bash
rtk git add .claude/workflows/flow.js scripts/flow.test.js
rtk git commit -m "feat: run flow steps up to the next gate and save the state" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The fix-loop engine

**Files:**
- Modify: `.claude/workflows/flow.js` (add schemas, `fixLoop`, prompt builders, `renderFixReport`; change the loop in `runSegment`; add the `escalated` message), `scripts/flow.test.js`

**Interfaces:**
- Consumes (Task 2): `runSegment`, `savePrompt(cur, report)` (the report text goes between `<<<REPORT` and `REPORT>>>`), `TIERS`, `MAX_ROUNDS`.
- Produces: `fixLoop(task) -> { green, rounds, reason }`; agent labels `fix-loop#<n>:test`, `fix-loop#<n>:review` (with `agentType: 'reviewer'`), `fix-loop#<n>:fix`, phase `Fix loop`; outcome `escalated`.

- [ ] **Step 1: Write the failing tests**

In `scripts/flow.test.js`, insert immediately above `// === SECTION: opts sanity ===`:

```js
  // === SECTION: fix-loop ===
  const FAIL_T = (n) => ({ passed: false, command: 'npm test', summary: `t${n} fails`, failures: [`t${n}`] });
  const BLOCK = (...b) => ({ verdict: 'BLOCK', blockers: b });
  const fromImplement = (extra = {}) => makeWorld({
    files: { 'docs/flow-state.json': stateJson({ completed: STEPS_ALL().slice(0, 6), approved: ['requirements'] }) },
    ...extra,
  });
  const loopLabels = (labels) => labels.filter((l) => l.startsWith('fix-loop#'));

  // green on round 1, then deliver
  w = fromImplement();
  r = await run(w, undefined);
  check('green on round 1: test and review run, no fix', same(loopLabels(r.labels).sort(), ['fix-loop#1:review', 'fix-loop#1:test']));
  check('green fix-loop proceeds to deliver and stops at the release gate', r.labels.includes('deliver') && r.out.outcome === 'gate' && /approve deliver/.test(r.out.message));
  check('all eight steps are saved as completed', same(w.saves.at(-1).completed, STEPS_ALL()));
  check('the fix-loop record is saved and says GREEN', w.reports.length === 1 && /round 1: tests PASS/.test(w.reports[0]) && /result: GREEN/.test(w.reports[0]));
  const reviewCall = r.calls.find((c) => c.opts.label === 'fix-loop#1:review');
  const testCall = r.calls.find((c) => c.opts.label === 'fix-loop#1:test');
  check('the review agent is the reviewer agent type', reviewCall.opts.agentType === 'reviewer');
  check('the test agent is not', testCall.opts.agentType === undefined);
  check('test and review use the Fix loop phase', reviewCall.opts.phase === 'Fix loop' && testCall.opts.phase === 'Fix loop');
  check('the test agent is told not to modify files', /Do not modify any file/.test(testCall.prompt));
  check('the review prompt points at the spec', /docs\/spec\.md/.test(reviewCall.prompt));

  // green on round 3
  w = fromImplement({ tests: [FAIL_T(1), TEST_PASS_(), TEST_PASS_()], reviews: [BLOCK('blocker-alpha'), BLOCK('b'), REVIEW_PASS_()] });
  r = await run(w, undefined);
  check('green on round 3 runs two fix agents', loopLabels(r.labels).filter((l) => l.endsWith(':fix')).length === 2);
  check('green on round 3 still reaches deliver', r.labels.includes('deliver') && r.out.outcome === 'gate');
  check('the record lists three rounds', (w.reports[0].match(/- round \d/g) || []).length === 3);
  const fixCall = r.calls.find((c) => c.opts.label === 'fix-loop#1:fix');
  check('the fix prompt carries the blocker and the failing test', fixCall.prompt.includes('blocker-alpha') && fixCall.prompt.includes('t1'));
  check('the fix prompt forbids weakening tests', /do not weaken or delete tests/i.test(fixCall.prompt));
  check('the fix prompt forbids push', /Never push, never open a pull request and never merge\./.test(fixCall.prompt));

  // cap: five rounds, each different, never green
  w = fromImplement({
    tests: [1, 2, 3, 4, 5].map(FAIL_T),
    reviews: [1, 2, 3, 4, 5].map((n) => BLOCK(`b${n}`)),
  });
  r = await run(w, undefined);
  check('five rounds without green escalate', r.out.outcome === 'escalated' && /after 5 rounds/.test(r.out.message));
  check('exactly five rounds ran', loopLabels(r.labels).filter((l) => l.endsWith(':test')).length === 5);
  check('four fix agents ran (none after the last round)', loopLabels(r.labels).filter((l) => l.endsWith(':fix')).length === 4);
  check('deliver never runs after an escalation', !r.labels.includes('deliver'));
  check('the state stops before fix-loop so /flow retries it', same(w.saves.at(-1).completed, STEPS_ALL().slice(0, 6)) && /^fix-loop:/.test(w.saves.at(-1).failure));
  check('the record says NOT GREEN', /result: NOT GREEN/.test(w.reports[0]));
  check('the escalation message points at the run-log', /docs\/run-log\.md/.test(r.out.message));

  // early stop: identical failures twice
  w = fromImplement({ tests: [FAIL_T(1), FAIL_T(1)], reviews: [BLOCK('same'), BLOCK('same')] });
  r = await run(w, undefined);
  check('identical failures twice stop early', r.out.outcome === 'escalated' && /no progress/.test(r.out.message));
  check('only two rounds and one fix ran', loopLabels(r.labels).filter((l) => l.endsWith(':test')).length === 2 && loopLabels(r.labels).filter((l) => l.endsWith(':fix')).length === 1);
  w = fromImplement({ tests: [FAIL_T(1), FAIL_T(1)], reviews: [BLOCK('x', 'y'), BLOCK('y', 'x')] });
  r = await run(w, undefined);
  check('the same blockers in a different order still count as no progress', r.out.outcome === 'escalated' && /no progress/.test(r.out.message));

  // never green unless both
  w = fromImplement({ tests: [TEST_PASS_(), TEST_PASS_()], reviews: [BLOCK('x'), BLOCK('x')] });
  r = await run(w, undefined);
  check('tests green but review BLOCK is not green', r.out.outcome === 'escalated' && !r.labels.includes('deliver'));
  w = fromImplement({ tests: [FAIL_T(1), TEST_PASS_()], reviews: [REVIEW_PASS_(), REVIEW_PASS_()] });
  r = await run(w, undefined);
  check('review PASS but tests failing is not green on that round, and a later round can be', r.labels.includes('deliver') && loopLabels(r.labels).filter((l) => l.endsWith(':fix')).length === 1);
  w = fromImplement({ tests: [TEST_PASS_(), TEST_PASS_()], reviews: [{ verdict: 'PASS', blockers: ['x'] }, REVIEW_PASS_()] });
  r = await run(w, undefined);
  check('a PASS verdict with a blocker is not green', loopLabels(r.labels).filter((l) => l.endsWith(':fix')).length === 1 && /round 2/.test(w.reports[0]));

  // agents that return nothing
  w = fromImplement({ reviews: [null] });
  r = await run(w, undefined);
  check('a review agent that returns nothing escalates', r.out.outcome === 'escalated' && /review agent did not return/.test(r.out.message));
  check('and no fix agent or deliver runs', !r.labels.some((l) => l.endsWith(':fix')) && !r.labels.includes('deliver'));
  w = fromImplement({ tests: [null] });
  r = await run(w, undefined);
  check('a test agent that returns nothing escalates', r.out.outcome === 'escalated' && /test agent did not return/.test(r.out.message));
  w = fromImplement({ tests: [FAIL_T(1)], reviews: [BLOCK('a')] });
  const respondFix = w.respond;
  w.respond = (call) => (call.opts.label === 'fix-loop#1:fix' ? null : respondFix(call));
  r = await run(w, undefined);
  check('a fix agent that returns nothing escalates', r.out.outcome === 'escalated' && /fix agent did not return/.test(r.out.message));

  // a full run from the start through every gate
  w = makeWorld();
  await run(w, 'ship the thing');
  await run(w, 'approve requirements');
  r = await run(w, undefined);
  check('the whole flow runs design..deliver after the first approval', same(r.labels.filter((l) => !l.startsWith('fix-loop#')), ['state', 'design', 'blueprint', 'breakdown', 'implement', 'deliver', 'save']));
  r = await run(w, 'approve deliver');
  check('approving deliver finishes the flow', r.out.outcome === 'approved');
  r = await run(w, undefined);
  check('and /flow then reports it complete', r.out.outcome === 'complete');
  r = await run(w, 'status');
  check('status of a finished flow says every step is done', /every step is done/.test(r.out.message));

```

Also add these two helpers at the very bottom of `scripts/flow.test.js` (next to `STEPS_ALL`):

```js
function TEST_PASS_() { return require('./lib/flowsim').TEST_PASS; }
function REVIEW_PASS_() { return require('./lib/flowsim').REVIEW_PASS; }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node scripts/flow.test.js`
Expected: FAIL lines such as `FAIL: green on round 1: test and review run, no fix` (the loop does not exist; `fix-loop` is run as a plain step).

- [ ] **Step 3: Implement the fix-loop**

In `.claude/workflows/flow.js`, add these schemas directly after `STEP_SCHEMA`:

```js
const TEST_SCHEMA = {
  type: 'object',
  properties: {
    passed: { type: 'boolean' },
    command: { type: 'string' },
    summary: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
  required: ['passed', 'command', 'summary', 'failures'],
};
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'BLOCK'] },
    blockers: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'blockers'],
};
const FIX_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } } },
  required: ['summary', 'changed'],
};
```

Add this block directly above the `// ---- commands` line (after `stepProblem`):

```js
// ---- fix-loop ---------------------------------------------------------------

const testPrompt = (round) => [
  `Fix-loop round ${round}: run this project's tests.`,
  'Find the test command (for example npm test, go test ./..., pytest, ./gradlew test, mvn test) and run it. Do not modify any file.',
  'Report passed (true only if every test passed), the exact command you ran, a one-sentence summary, and failures (one short string per failing test, empty when everything passed).',
].join('\n');

const reviewPrompt = (round, task) => [
  `Fix-loop round ${round}: review the current change in this repository against the acceptance criteria in docs/spec.md. Task: ${task}`,
  'Follow your reviewer instructions. Report through the structured result: verdict PASS or BLOCK, and blockers = one string per [BLOCKER] finding (an empty list when the verdict is PASS).',
].join('\n');

const fixPrompt = (round, test, review) => [
  `Fix-loop round ${round}: make the change pass.`,
  `Failing tests: ${test.failures.length ? test.failures.join(' | ') : '(none)'}`,
  `Reviewer blockers: ${review.blockers.length ? review.blockers.join(' | ') : '(none)'}`,
  'Apply targeted fixes for exactly these problems. Do not change docs/spec.md, and do not weaken or delete tests to make them pass.',
  NO_PUSH,
  'Report a one-line summary and the repo-relative paths you changed.',
].join('\n');

async function fixLoop(task) {
  const rounds = [];
  let previous = null;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const [test, review] = await parallel([
      () => agent(testPrompt(round), { label: `fix-loop#${round}:test`, phase: 'Fix loop', schema: TEST_SCHEMA, ...TIERS.test }),
      () => agent(reviewPrompt(round, task), { label: `fix-loop#${round}:review`, phase: 'Fix loop', schema: REVIEW_SCHEMA, agentType: 'reviewer', ...TIERS.review }),
    ]);
    if (!test || !review) {
      const who = !test ? 'test' : 'review';
      rounds.push({ round, note: `the ${who} agent did not return a result` });
      return { green: false, rounds, reason: `round ${round}: the ${who} agent did not return a result` };
    }
    rounds.push({ round, testPassed: test.passed, command: test.command, verdict: review.verdict, blockers: review.blockers, failures: test.failures });
    if (test.passed && review.verdict === 'PASS' && review.blockers.length === 0) return { green: true, rounds, reason: '' };
    if (round === MAX_ROUNDS) return { green: false, rounds, reason: `still not green after ${MAX_ROUNDS} rounds` };
    const signature = JSON.stringify([test.passed, [...test.failures].sort(), [...review.blockers].sort()]);
    if (signature === previous) {
      return { green: false, rounds, reason: `round ${round} repeated the failures and blockers of round ${round - 1}: no progress` };
    }
    previous = signature;
    const fix = await agent(fixPrompt(round, test, review), { label: `fix-loop#${round}:fix`, phase: 'Fix loop', schema: FIX_SCHEMA, ...TIERS.fix });
    if (!fix) {
      rounds.push({ round, note: 'the fix agent did not return a result' });
      return { green: false, rounds, reason: `round ${round}: the fix agent did not return a result` };
    }
  }
  return { green: false, rounds, reason: 'the fix-loop ended without a result' };
}

function renderFixReport(fl) {
  const lines = fl.rounds.map((r) => {
    if (r.note) return `- round ${r.round}: ${r.note}`;
    const extra = [];
    if (r.blockers.length) extra.push(`blockers: ${r.blockers.join(' | ')}`);
    if (r.failures.length) extra.push(`failing: ${r.failures.join(' | ')}`);
    return `- round ${r.round}: tests ${r.testPassed ? 'PASS' : 'FAIL'} (${r.command}), review ${r.verdict}${extra.length ? `, ${extra.join(', ')}` : ''}`;
  });
  lines.push(fl.green ? '- result: GREEN' : `- result: NOT GREEN - ${fl.reason}`);
  return lines.join('\n');
}
```

In `runSegment`, replace the body of the `for` loop. The old loop is:

```js
  for (const step of STEPS.slice(cur.completed.length)) {
    log(`Running step: ${step}`);
    const out = await agent(stepPrompt(step, cur.task), { label: step, phase: 'Steps', schema: STEP_SCHEMA, ...TIERS.step });
    const problem = stepProblem(step, out);
    if (problem) {
      cur.failure = `${step}: ${problem}`;
      outcome = 'failed';
      break;
    }
    cur.completed.push(step);
    if (gates.includes(step)) break;
  }
```

The new loop is:

```js
  for (const step of STEPS.slice(cur.completed.length)) {
    log(`Running step: ${step}`);
    if (step === 'fix-loop') {
      const fl = await fixLoop(cur.task);
      reports.push(renderFixReport(fl));
      if (!fl.green) {
        cur.failure = `fix-loop: ${fl.reason}`;
        outcome = 'escalated';
        break;
      }
    } else {
      const out = await agent(stepPrompt(step, cur.task), { label: step, phase: 'Steps', schema: STEP_SCHEMA, ...TIERS.step });
      const problem = stepProblem(step, out);
      if (problem) {
        cur.failure = `${step}: ${problem}`;
        outcome = 'failed';
        break;
      }
    }
    cur.completed.push(step);
    if (gates.includes(step)) break;
  }
```

Directly after the `if (outcome === 'failed') { ... }` block at the end of `runSegment`, add:

```js
  if (outcome === 'escalated') {
    return result('escalated', `The fix-loop is not green: ${cur.failure.replace(/^fix-loop: /, '')}. See "## Fix-loop (flow)" in docs/run-log.md. Fix it yourself or change the spec, then run /flow to run the fix-loop again.`, { completed: done, failure: cur.failure });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node scripts/flow.test.js`
Expected: `PASS (flow)`. Then `npm test` — all suites `PASS`.

- [ ] **Step 5: Commit**

```bash
rtk git add .claude/workflows/flow.js scripts/flow.test.js
rtk git commit -m "feat: add the script-driven fix-loop with independent review to /flow" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Static lint, release 1.1.0 and documentation

**Files:**
- Modify: `scripts/check-harness.js`, `scripts/check-harness.test.js`, `harness.manifest.json`, `CHANGELOG.md`, `CLAUDE.md`, `product-template/CLAUDE.md.tmpl`
- Create: `docs/flow.md`

**Interfaces:**
- Produces (`check-harness.js`): `workflowProblems(source) -> string[]` (exported); `check-harness` now fails when `.claude/workflows/flow.js` is missing or any `.claude/workflows/*.js` breaks the rules.

- [ ] **Step 1: Write the failing tests**

In `scripts/check-harness.test.js`, add to the existing requires: `const { staleNotes, workflowProblems } = require('./check-harness');` (replace the current destructuring that imports only `staleNotes`). Insert immediately before the final `if (!ok) process.exit(1);`:

```js
// AC8: workflow lint
check('AC8 a clean workflow has no problems', workflowProblems('export const meta = { name: "x", description: "y" };\nconst a = 1;\n').length === 0);
check('AC8 forbidden tokens in comments are fine', workflowProblems('// Date.now() and Math.random() are disabled\nexport const meta = { name: "x", description: "y" };\n').length === 0);
check('AC8 /* block */ comments are ignored', workflowProblems('/* new Date() import( */\nexport const meta = { name: "x", description: "y" };\n').length === 0);
check('AC8 Date.now is rejected', workflowProblems('export const meta = { name: "x", description: "y" };\nconst t = Date.now();\n').some((p) => /Date\.now/.test(p)));
check('AC8 Math.random is rejected', workflowProblems('export const meta = { name: "x", description: "y" };\nMath.random();\n').some((p) => /Math\.random/.test(p)));
check('AC8 argless new Date() is rejected', workflowProblems('export const meta = { name: "x", description: "y" };\nnew Date();\n').some((p) => /new Date/.test(p)));
check('AC8 new Date(x) is allowed', workflowProblems('export const meta = { name: "x", description: "y" };\nnew Date(0);\n').length === 0);
check('AC8 import() is rejected', workflowProblems('export const meta = { name: "x", description: "y" };\nimport("fs");\n').some((p) => /import\(\)/.test(p)));
check('AC8 a file without meta first is rejected', workflowProblems('const a = 1;\nexport const meta = {};\n').some((p) => /export const meta/.test(p)));

const lintFixture = fullFixture();
write(path.join(lintFixture, '.claude/workflows/bad.js'), 'export const meta = { name: "bad", description: "d" };\nconst t = Date.now();\n');
const lint = run(lintFixture);
check('AC8 check-harness fails on a bad workflow and names it', lint.code === 1 && /workflow bad\.js: .*Date\.now/.test(lint.out));
fs.rmSync(path.join(lintFixture, '.claude/workflows/bad.js'));
fs.rmSync(path.join(lintFixture, '.claude/workflows/flow.js'));
const noFlow = run(lintFixture);
check('AC8 check-harness requires flow.js', noFlow.code === 1 && /missing workflow: \.claude\/workflows\/flow\.js/.test(noFlow.out));
fs.rmSync(lintFixture, { recursive: true, force: true });
check('AC8 the real workflows all pass the lint', ['flow.js', 'product-brainstorm.js', 'study-research.js'].every((f) => workflowProblems(fs.readFileSync(path.join(REPO, '.claude', 'workflows', f), 'utf8')).length === 0));
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/check-harness.test.js`
Expected: FAIL — `workflowProblems is not a function`.

- [ ] **Step 3: Implement the lint**

In `scripts/check-harness.js`, add above `function main()`:

```js
// Static rules for workflow scripts (the runtime throws on these at run time).
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function workflowProblems(src) {
  const code = stripComments(src);
  const problems = [];
  if (!/^\s*export const meta = \{/.test(code)) problems.push('must start with "export const meta = {" (a literal object)');
  const banned = [
    [/\bimport\s*\(/, 'import() is not allowed in a workflow script'],
    [/\bDate\.now\b/, 'Date.now is disabled in workflow scripts'],
    [/\bMath\.random\b/, 'Math.random is disabled in workflow scripts'],
    [/\bnew Date\(\s*\)/, 'new Date() without arguments is disabled in workflow scripts'],
  ];
  for (const [re, msg] of banned) if (re.test(code)) problems.push(msg);
  return problems;
}
```

In `main()`, directly after the harness-skill check (the `SKILL.md missing "name: harness"` block), add:

```js
  const wfDir = path.join(root, '.claude', 'workflows');
  if (!fs.existsSync(path.join(wfDir, 'flow.js'))) problems.push('missing workflow: .claude/workflows/flow.js');
  if (fs.existsSync(wfDir)) {
    for (const f of fs.readdirSync(wfDir).filter((x) => x.endsWith('.js'))) {
      for (const p of workflowProblems(fs.readFileSync(path.join(wfDir, f), 'utf8'))) problems.push(`workflow ${f}: ${p}`);
    }
  }
```

Change the export line to `module.exports = { staleNotes, workflowProblems };`.

- [ ] **Step 4: Release 1.1.0**

Edit `harness.manifest.json`: set `"harnessVersion": "1.1.0"`.

Insert in `CHANGELOG.md` directly above the line `## 1.0.0`:

```markdown
## 1.1.0 (minor: additive)
- New `/flow` workflow: one command that runs the existing 8 steps (explore .. deliver) up to the next human gate and stops. `/flow <task>`, `/flow`, `/flow status`, `/flow approve <step>`. Gates after `requirements` and `deliver` are required; a repo may add more in `docs/flow.config.json` (`extraGates`). State lives in `docs/flow-state.json`.
- The fix-loop inside `/flow` runs test and independent review (the `reviewer` agent) in parallel, at most 5 rounds, and stops early when two rounds in a row fail the same way. It never reports green unless tests pass and the review is PASS.
- New `scripts/flow-report.js`: prints token usage per agent and phase for a workflow run (no tokens spent).
- `check-harness` now lints every `.claude/workflows/*.js` and requires `flow.js`.
- The existing commands, skill and `reviewer` agent are unchanged; the manual pipeline still works.
```

- [ ] **Step 5: Documentation**

Create `docs/flow.md`:

```markdown
# /flow — the generic delivery flow

`/flow` runs the harness pipeline (explore, requirements, design, blueprint, breakdown,
implement, fix-loop, deliver) as one background workflow and stops at the next human
gate. The content of every step is read from `.claude/commands/<step>.md`, so the manual
commands and `/flow` always agree.

## Commands
- `/flow <description>` starts a task and runs to the first gate (after `requirements`).
- `/flow` continues from where the task stopped, to the next gate.
- `/flow status` shows the task, the next step and any gate waiting for you (read only).
- `/flow approve <step>` records your approval of a gate. It runs nothing.
- `/flow start <description>` forces a new task whose text starts with a word such as approve.

## Gates
`requirements` (approve the scope) and `deliver` (approve the release) are always gates.
To add more, create `docs/flow.config.json`:

    { "extraGates": ["design"] }

Only `extraGates` is accepted; the two required gates cannot be removed. The flow never
pushes, opens a pull request or merges: after `deliver` you do that yourself.

## State
`docs/flow-state.json` is written by the flow: the task, the completed steps, the
approved gates and the last failure. To abandon a task, delete it.

## Cost
A run starts several agents, each with its own context, so it costs more than typing the
commands yourself. For small changes use the manual commands. To see what a run cost:

    node <path-to-claude-harness>/scripts/flow-report.js --project <this repo>

It lists tokens per agent and phase from Claude Code's own run records.
```

In `CLAUDE.md`, add directly above the line `### Classifying a harness change (decides the version bump)`:

```markdown
## /flow
`/flow` (see `docs/flow.md`) runs the 8-step pipeline as a workflow up to the next
human gate. Step content comes from `.claude/commands/`; change a step there, not in
`flow.js`. `scripts/flow.test.js` tests the control flow with no tokens
(`npm test`); `scripts/flow-report.js` reports what a run cost.
```

In `product-template/CLAUDE.md.tmpl`, replace the line `Available now: \`/product-brainstorm\`. The other stages arrive through` and the following line `` `sync-harness` as the harness ships them. `` with:

```
Available now: `/product-brainstorm` and `/flow` (see `docs/flow.md`). The other
stages arrive through `sync-harness` as the harness ships them.
```

(Check the exact two lines first with `grep -n "Available now" product-template/CLAUDE.md.tmpl` and edit those lines only.)

- [ ] **Step 6: Verify**

Run: `npm test && node scripts/check-harness.js`
Expected: all `PASS` lines, then `harness OK` (a `note:` line about `ridgo` being behind 1.1.0 is expected and is not an error).

- [ ] **Step 7: Commit**

```bash
rtk git add scripts/check-harness.js scripts/check-harness.test.js harness.manifest.json CHANGELOG.md CLAUDE.md product-template/CLAUDE.md.tmpl docs/flow.md
rtk git commit -m "feat: lint workflow scripts, release 1.1.0 and document /flow" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cost report (`scripts/flow-report.js`)

**Files:**
- Create: `scripts/lib/flow-report.js`, `scripts/flow-report.js`, `scripts/flow-report.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces (`lib/flow-report.js`): `projectDirName(repoPath) -> string`; `findProjectDir(repoPath, projectsRoot) -> string` (throws if not found); `listRuns(projectDir) -> Array<{ runId, dir, mtimeMs }>` newest first; `readRun(dir) -> { runId, agents: Array<{ label, phase, calls, input, output, cacheRead, cacheCreation }>, badLines }` (throws if the folder has no `agent-*.jsonl`); `summarize(agents) -> { total, byPhase }`; `formatReport(run) -> string`.
- Run records live in `<projects>/<project>/<session>/subagents/workflows/wf_<id>/` with `agent-<id>.meta.json` (`description` = label, `workflowPhase`) and `agent-<id>.jsonl` (lines with `message.id` and `message.usage`). This is Claude Code's internal layout, observed on 2.1.289; the script must fail with a clear message when it does not match.

- [ ] **Step 1: Write the failing tests**

Create `scripts/flow-report.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/flow-report.test.js`
Expected: FAIL — `Cannot find module './lib/flow-report'`.

- [ ] **Step 3: Implement the library**

Create `scripts/lib/flow-report.js`:

```js
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
```

- [ ] **Step 4: Implement the CLI**

Create `scripts/flow-report.js`:

```js
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
```

- [ ] **Step 5: Run to verify success, then wire into `npm test`**

Run: `node scripts/flow-report.test.js`
Expected: `PASS (flow-report)`.
Edit `package.json`: append ` && node scripts/flow-report.test.js` to the `"test"` value. Run `npm test` — all suites `PASS`. Then, as a read-only sanity check on real data (prints numbers, changes nothing): `node scripts/flow-report.js --project D:\internal_project\ridgo --list`.
Expected: at least one `wf_...` line (the earlier product-brainstorm runs); if the real layout differs the error must be the clear "layout may have changed" message, not a crash.

- [ ] **Step 6: Commit**

```bash
rtk git add scripts/lib/flow-report.js scripts/flow-report.js scripts/flow-report.test.js package.json
rtk git commit -m "feat: add flow-report to total token usage per workflow run" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `sync-harness --adopt` and a configurable base branch (added at the user's request; execute after Task 5 and BEFORE Task 6)

**Why:** repos created before `new-product.js` existed (such as `D:\internal_project\string-art`) have no `.claude/.harness-version`, so sync refuses them; and `string-art` uses `master`, while sync only cut its worktree from `main`.

**Files:**
- Create: `scripts/lib/adopt.js`, `scripts/lib/skip.js`, `scripts/adopt.test.js`
- Modify: `scripts/lib/sync.js` (`createSyncWorktree` + new `pickBase`), `scripts/sync-harness.js`, `package.json`, `docs/bootstrap.md`, `CHANGELOG.md`

**Interfaces:**
- Produces (`adopt.js`): `adoptProduct({ harnessRoot, productDir, name?, register? = true }) -> { dir, version, identical, differs, missing, skipped }` (arrays of relative posix paths). It writes ONLY `<dir>/.claude/.harness-version`, recording `harnessVersion` (the current harness version), `harnessCommit`, `harnessDirty`, `syncedAt` and `files` = hashes of the managed files that are **identical** to the harness. Files that differ or are missing are not recorded, so the next sync reports them as `conflict` (never overwritten) or `add`. It never commits and never touches any other file. Throws: `directory not found`, `not a Claude Code project (no .claude/)`, `already adopted`, `not a git repository`, `harness.manifest.json has no harnessVersion`.
- Produces (`skip.js`): `readSkip(productRoot) -> string[]` reads the product's own `.claude/harness.skip.json` (`{ "skip": ["<managed path>", ...] }`) and returns the listed paths; no file means `[]`. A repo uses it to opt out of managed files that are not generic for it (for example the Ridgo-specific `.claude/workflows/product-brainstorm.js` in `string-art`). Errors: `.claude/harness.skip.json is not valid JSON`; `... must be an object with only a "skip" list`; `... "skip" must list relative paths with forward slashes`. The file belongs to the product: sync never writes it.
- `planSync` ignores skipped paths completely (never added, never updated, never conflicted, and never REMOVED even if an old version file recorded them) and returns two extra fields `skipped` (skip entries that are managed files) and `skipUnknown` (skip entries the harness does not manage, probably typos); `formatPlan` prints them (`skipped  <path>` and `WARN     skip entry <path> is not a managed file (typo?)`). `adoptProduct` also honours the list: skipped files are neither recorded nor reported as missing, and it returns `skipped`.
- Produces (`sync.js`): `createSyncWorktree(productRoot, version, baseBranch?) -> { dir, branch, reused, base, baseName }`. With no `baseBranch` it uses `main`, else `master`; the worktree is cut from the resolved commit SHA (not the branch name, which also avoids the "ambiguous name when a tag has the same name" failure). Errors: `product has no "main" branch (and no "master"); ...` (the existing test regex `/product has no "main" branch/` still matches), `product has no "<name>" branch (given with --base)`, `invalid --base "<name>"`.
- CLI: `node scripts/sync-harness.js --adopt <repo>`; `node scripts/sync-harness.js <repo> --apply --base <branch>`. `--adopt` cannot be combined with `--all`, `--apply`, `--in-place` or `--base`; `--base` cannot be combined with `--all`.

- [ ] **Step 1: Write the failing tests**

Create `scripts/adopt.test.js`:

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node scripts/adopt.test.js`
Expected: FAIL — `Cannot find module './lib/adopt'`.

- [ ] **Step 3: Implement `adopt.js`**

Create `scripts/lib/adopt.js`:

```js
// adopt.js — bring a product repo that was NOT created by new-product.js under the sync.
// Writes only <dir>/.claude/.harness-version, recording the managed files that are
// identical to the harness. Differing files are left unrecorded so the next sync
// reports them as conflicts instead of overwriting them. Never commits.
const fs = require('fs');
const path = require('path');
const { listManaged, readManifest, sha256 } = require('./fsutil');
const { harnessState, gitOut } = require('./git');
const { registerProduct } = require('./registry');
const { readSkip } = require('./skip');

function adoptProduct({ harnessRoot, productDir, name, register = true }) {
  const dir = path.resolve(productDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`directory not found: ${dir}`);
  if (!fs.existsSync(path.join(dir, '.claude'))) throw new Error(`not a Claude Code project (no .claude/): ${dir}`);
  const vf = path.join(dir, '.claude', '.harness-version');
  if (fs.existsSync(vf)) throw new Error(`already adopted (.claude/.harness-version exists): ${dir}`);
  if (gitOut(['rev-parse', '--is-inside-work-tree'], dir) !== 'true') throw new Error(`not a git repository: ${dir}`);
  const version = readManifest(harnessRoot).harnessVersion;
  if (!version) throw new Error('harness.manifest.json has no harnessVersion');

  const skip = new Set(readSkip(dir));
  const files = {};
  const identical = [];
  const differs = [];
  const missing = [];
  const skipped = [];
  for (const rel of listManaged(harnessRoot)) {
    if (skip.has(rel)) { skipped.push(rel); continue; }
    const p = path.join(dir, rel);
    if (!fs.existsSync(p)) { missing.push(rel); continue; }
    const mine = sha256(p);
    if (mine === sha256(path.join(harnessRoot, rel))) { files[rel] = mine; identical.push(rel); } else differs.push(rel);
  }

  const state = harnessState(harnessRoot);
  fs.writeFileSync(vf, JSON.stringify({
    harnessVersion: version,
    harnessCommit: state.commit,
    harnessDirty: state.dirty,
    syncedAt: new Date().toISOString(),
    files,
  }, null, 2) + '\n');
  if (register) registerProduct(harnessRoot, { name: name || path.basename(dir), path: dir });
  return { dir, version, identical, differs, missing, skipped };
}

module.exports = { adoptProduct };
```

- [ ] **Step 4: Change `createSyncWorktree` in `scripts/lib/sync.js`**

Add directly above `function createSyncWorktree`:

```js
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;

// The branch the sync worktree is cut from: --base, else main, else master.
function pickBase(productRoot, want) {
  const sha = (b) => gitOut(['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], productRoot);
  if (want !== undefined) {
    if (!BRANCH_RE.test(want)) throw new Error(`invalid --base "${want}"`);
    const s = sha(want);
    if (!s) throw new Error(`product has no "${want}" branch (given with --base)`);
    return { name: want, sha: s };
  }
  for (const b of ['main', 'master']) {
    const s = sha(b);
    if (s) return { name: b, sha: s };
  }
  throw new Error('product has no "main" branch (and no "master"); the sync branch is cut from the base branch, so name it main or master, or pass --base <branch>');
}
```

Change the signature line to `function createSyncWorktree(productRoot, version, baseBranch) {`, change the reuse return to `return { dir, branch, reused: true, base: null, baseName: null };`, and replace the block from the comment `// branch from main explicitly` through the final `return` with:

```js
  // branch from the base branch explicitly: the product may have an unmerged task branch checked out
  const base = pickBase(productRoot, baseBranch);
  try {
    execFileSync('git', ['worktree', 'add', '-b', branch, dir, base.sha], { cwd: productRoot, stdio: 'pipe' });
  } catch (e) {
    throw new Error(`could not create worktree ${dir} on ${branch}: ${String(e.stderr || e.message).trim()}`);
  }
  return { dir, branch, reused: false, base: base.sha.slice(0, 7), baseName: base.name };
```

- [ ] **Step 4b: Add the per-repo skip list**

Create `scripts/lib/skip.js`:

```js
// skip.js — a product can opt out of managed files with .claude/harness.skip.json:
//   { "skip": ["<managed path>", ...] }
// The file belongs to the product; sync never writes it.
const fs = require('fs');
const path = require('path');

function readSkip(productRoot) {
  const f = path.join(productRoot, '.claude', 'harness.skip.json');
  if (!fs.existsSync(f)) return [];
  let o;
  try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Error('.claude/harness.skip.json is not valid JSON'); }
  if (!o || typeof o !== 'object' || Array.isArray(o) || Object.keys(o).some((k) => k !== 'skip')) {
    throw new Error('.claude/harness.skip.json must be an object with only a "skip" list');
  }
  const okPath = (x) => typeof x === 'string' && x !== '' && !x.includes('\\') && !path.isAbsolute(x) && !x.split('/').includes('..');
  if (!Array.isArray(o.skip) || !o.skip.every(okPath)) {
    throw new Error('.claude/harness.skip.json: "skip" must list relative paths with forward slashes');
  }
  return o.skip;
}

module.exports = { readSkip };
```

In `scripts/lib/sync.js` add `const { readSkip } = require('./skip');` below the other requires, add `'.claude/harness.skip.json'` to the `PROTECTED` array, and in `planSync` replace the three lines

```js
  const wanted = listManaged(harnessRoot);
  const plan = {
    add: [], update: [], remove: [], conflict: [], kept: [], current: [], refresh: [],
    versionFrom, versionTo, settingsMissing: [],
  };
```

with

```js
  const skipList = readSkip(productRoot);
  const skip = new Set(skipList);
  const allManaged = listManaged(harnessRoot);
  const wanted = allManaged.filter((r) => !skip.has(r));
  const plan = {
    add: [], update: [], remove: [], conflict: [], kept: [], current: [], refresh: [],
    versionFrom, versionTo, settingsMissing: [],
    skipped: allManaged.filter((r) => skip.has(r)),
    skipUnknown: skipList.filter((r) => !allManaged.includes(r)),
  };
```

and in the removal loop change `if (wanted.includes(rel)) continue;` to `if (wanted.includes(rel) || skip.has(rel)) continue;`. In `formatPlan` add, directly above the `for (const c of newCommands(plan))` line:

```js
  for (const f of plan.skipped) lines.push(`  skipped  ${f}  (this repo opts out in .claude/harness.skip.json)`);
  for (const f of plan.skipUnknown) lines.push(`  WARN     skip entry ${f} is not a managed file (typo?)`);
```

Run `node scripts/adopt.test.js` and `node scripts/sync-harness.test.js`; both must pass (the existing sync tests have no skip file, so they are unaffected).

- [ ] **Step 5: Change the CLI `scripts/sync-harness.js`**

Add `const { adoptProduct } = require('./lib/adopt');` below the other requires. Replace the two `usage` lines that print the usage with:

```js
  console.error('usage: sync-harness.js <product-dir> | --all [--apply] [--in-place] [--base <branch>]');
  console.error('       sync-harness.js --adopt <product-dir>');
  console.error('  --adopt records an older repo (not made by new-product.js) so it can be synced; it writes only .claude/.harness-version');
  console.error('  --base picks the branch the sync worktree is cut from (default: main, else master); single repo only');
  console.error('  --in-place is an emergency/testing exception: it writes into the product directory (single repo only)');
```

Change `syncOne`'s signature to `function syncOne(harnessRoot, name, dir, { apply, inPlace, base })`, the worktree line to `const wt = createSyncWorktree(dir, plan.versionTo, base);`, and the base message to:

```js
  console.log(`  applied in ${wt.dir} on branch ${wt.branch}${wt.base ? ` (base ${wt.base}, ${wt.baseName})` : ''}`);
```

In `main()`, change the `parseArgs` call to `{ values: ['--harness-root', '--base'], flags: ['--all', '--apply', '--in-place', '--adopt'] }`, change `options` to `{ apply: parsed.flags.has('--apply'), inPlace: parsed.flags.has('--in-place'), base: parsed.values['--base'] }`, and insert directly after the existing `if (target === '--all' && options.inPlace) { ... }` block:

```js
  if (parsed.flags.has('--adopt')) {
    if (all || options.apply || options.inPlace || options.base !== undefined) {
      console.error('sync failed: --adopt cannot be combined with --all, --apply, --in-place or --base');
      process.exit(1);
    }
    try {
      const r = adoptProduct({ harnessRoot, productDir: target });
      console.log(`adopted ${r.dir} at harness ${r.version}`);
      console.log(`  recorded ${r.identical.length} identical file(s); ${r.differs.length} differ (reported as conflicts, never overwritten); ${r.missing.length} missing (added by the next sync); ${r.skipped.length} skipped by .claude/harness.skip.json`);
      for (const f of r.differs) console.log(`  differs  ${f}`);
      for (const f of r.missing) console.log(`  missing  ${f}`);
      console.log('  wrote .claude/.harness-version; nothing was committed');
      console.log('  next: commit it on the base branch, then do a dry run:');
      console.log(`    git -C "${r.dir}" add .claude/.harness-version && git -C "${r.dir}" commit -m "chore: adopt harness sync"`);
      console.log(`    node scripts/sync-harness.js "${r.dir}"`);
      process.exit(0);
    } catch (e) {
      console.error(`sync failed: ${e.message}`);
      process.exit(1);
    }
  }
  if (target === '--all' && options.base !== undefined) {
    console.error('sync failed: --base cannot be combined with --all');
    process.exit(1);
  }
```

(`--adopt` with no repo is already a usage error because `!all && !parsed.positional.length` runs earlier. Check that the `--adopt --all` case prints "cannot be combined": the block above runs before the registry is read, so it does.)

- [ ] **Step 6: Run to verify success, wire into `npm test`, document**

Run: `node scripts/adopt.test.js`
Expected: `PASS (adopt)`. Then run the existing sync suite: `node scripts/sync-harness.test.js` — expected `PASS (sync-core)` (its "no main branch" test uses a branch named `trunk` and still matches the new message).
Edit `package.json`: append ` && node scripts/adopt.test.js` to the `"test"` value. Run `npm test` — seven `PASS` lines once Task 5 is in (six before it).
Append to `docs/bootstrap.md` a section titled `## Bringing an older repo under the sync`:

```markdown
## Bringing an older repo under the sync

A repo made before `new-product.js` existed has no `.claude/.harness-version`, so sync
refuses it. Record it once:

    node scripts/sync-harness.js --adopt <repo>

This writes only `.claude/.harness-version`, listing the managed files that are identical
to the harness (files the repo lists in `.claude/harness.skip.json` are ignored). Files that differ are reported as conflicts by later syncs and are never
overwritten; files that are missing are added. It commits nothing: commit the new file on
the base branch yourself, then run a dry run and `--apply` as usual. The sync worktree is
cut from `main`, else `master`; for any other branch pass `--base <branch>`.

### Opting out of a file

To keep a repo from receiving a managed file that is not generic for it, list the file in
the repo's own `.claude/harness.skip.json`:

    { "skip": [".claude/workflows/product-brainstorm.js"] }

Sync and `--adopt` then ignore those paths: they are never added, updated, reported as
conflicts or removed. The file belongs to the repo, so sync never writes it. An entry that
is not a managed file is reported as a probable typo.
```

Add this bullet to the `## 1.1.0` entry of `CHANGELOG.md` (below the `check-harness` bullet): `- `sync-harness.js --adopt <repo>` brings a repo made before `new-product.js` under the sync, and `--base <branch>` (default main, else master) picks the branch the sync worktree is cut from. A repo can opt out of managed files that are not generic for it with `.claude/harness.skip.json`.`

- [ ] **Step 7: Commit**

```bash
rtk git add scripts/lib/adopt.js scripts/lib/skip.js scripts/adopt.test.js scripts/lib/sync.js scripts/sync-harness.js package.json docs/bootstrap.md CHANGELOG.md
rtk git commit -m "feat: add sync-harness --adopt and a configurable base branch" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Real run, measurement and rollout (needs the user; do not run unattended; execute AFTER Task 7)

**Files:** none in this repo except `CHANGELOG.md` (add the measured numbers). Creates a throw-away repo in the OS temp directory.

**Interfaces:** consumes everything above. This task spends real tokens and writes into other repos, so **stop and ask the user before each step marked ASK**.

- [ ] **Step 1 (ASK): smoke run on a toy repo.** Ask: "Run `/flow` on a tiny throw-away repo to confirm the workflow works in the real runtime and to measure its cost? It uses real tokens (a start run is about 4 agents, the second run about 9 or more)." If yes:
  1. `node scripts/new-product.js flow-smoke --dir <os temp dir>`; inside it make a tiny Node project (one `add(a,b)` function and one test), `git add -A`, commit, and create `.claude/settings.local.json` with `{"enableWorkflows": true}`.
  2. In a Claude Code session opened in that folder, run `/flow add a subtract function with a test`. Expect it to stop after `requirements` with the message `Stopped at the "requirements" gate`.
  3. `/flow status`, then `/flow approve requirements`, then `/flow`. Expect it to run design through deliver and stop at `deliver`.
  4. Record anything unexpected (an agent that stops to ask, a missing `docs/spec.md`, the state file not written).

- [ ] **Step 2: Record the cost.** Run `node scripts/flow-report.js --project <flow-smoke folder> --list`, then once per run without `--list`. Add a `Measured on a toy repo` bullet with the TOTAL line of each run to the 1.1.0 entry of `CHANGELOG.md`, and commit: `rtk git add CHANGELOG.md` + `rtk git commit -m "docs: record the measured cost of /flow" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"`.

- [ ] **Step 3: Fix what the smoke run found.** Any defect found in Step 1 is a new finding: write the failing simulator test first (`scripts/flow.test.js`), then fix `flow.js`, then re-run the smoke step that failed. Do not paper over a runtime difference by editing the test.

- [ ] **Step 4 (ASK): roll out to `ridgo`.** Run `node scripts/sync-harness.js --all` (dry run). Expected for `ridgo`: `add .claude/workflows/flow.js` and a version change `1.0.0 -> 1.1.0`, no conflicts. Show the user the output and ask before `--apply`; `--apply` writes into `D:\internal_project\ridgo-sync` on branch `chore/harness-sync-v1.1.0` and commits nothing. `ridgo` must have `main` and a clean `.claude/` (its local `settings.local.json` is ignored by git).

- [ ] **Step 4b (ASK): bring `D:\internal_project\string-art` under the sync and roll `/flow` out to it.** `string-art` is a private GitHub repo on branch `master` (remote `origin`, already pushed). Ask the user first, then: (1) in `string-art` create `.claude/harness.skip.json` with `{ "skip": [".claude/workflows/product-brainstorm.js"] }` (that workflow is Ridgo-specific; the user wants `string-art` to receive only the generic workflows) and commit it on `master` together with step (2), never staging `img/`; then `node scripts/sync-harness.js --adopt D:\internal_project\string-art` (expected: the 10 command/agent/skill files recorded as identical, 0 differ, `product-brainstorm.js` skipped, `flow.js` missing so it will be added); (2) with the user's approval, commit the new `.claude/.harness-version` in `string-art` on `master` (`git -C D:\internal_project\string-art add .claude/.harness-version` then `commit -m "chore: adopt harness sync"` with the Sonnet 5.5 trailer; it must not stage `img/`); (3) dry run `node scripts/sync-harness.js D:\internal_project\string-art`, show it; (4) after approval `--apply` (writes `D:\internal_project\string-art-sync` on branch `chore/harness-sync-v1.1.0`, commits nothing); (5) the user reviews, commits, pushes and merges that branch themselves.

- [ ] **Step 5 (ASK): push.** Ask before pushing `feat/flow-workflow`. `claude-harness` is public; confirm nothing private is in the diff (`git diff origin/main..HEAD --stat`).

---

## Self-Review

**1. Spec coverage:** 4.1 commands, status, approve, `start` → Task 1. 4.2 gates (required + extra, unknown key, no push) → Tasks 1-3 (`parseConfig`, `NO_PUSH` in every prompt). 4.3 state shape → Task 1 (`parseState`, `savePrompt`). 4.4 phases (Load as the `state` agent, Steps, Save, artifact check) → Tasks 1-2. 4.4a Save payload delimiters and raw text read → Task 1. 4.5 fix-loop (parallel test+review, `reviewer` agentType, 5 rounds, early stop, never green unless both) → Task 3. 4.6 thin skeleton reading command files → Task 2 (`stepPrompt`). 4.6a effort tiers, short labels → Task 1 (`TIERS`) and the options-sanity checks. 4.7 report (dedupe by id, per agent/phase/total, `--append`, clear error on layout mismatch) → Task 5. 5 tests (vm simulator, static lint, real run) → Tasks 1-4 and 6. 6 release 1.1.0 and rollout → Tasks 4 and 6. Not built on purpose: plugins, UI, model names, G0-G3 pipeline (spec section 2).

**2. Placeholder scan:** no TBD/TODO. Task 1's `runSegment` is an intentional stub with an explicit replacement in Task 2 (its test only checks that a finished flow is "not refused"). Task 6 is operational with exact commands and explicit stop points.

**3. Type consistency:** state fields `task/completed/approved/failure` are the same in `parseState`, `savePrompt`, `runSegment`, `approve` and the simulator (`stateJson`). `result(outcome, message, extra)` outcomes used: `status, approved, refused, failed, gate, complete, escalated`. Agent labels: `state`, `<step>`, `fix-loop#<n>:test|review|fix`, `save`; the simulator routes on exactly these. `SAVE_SCHEMA` fields `savedCompleted/failure/missing` match the simulator's Save reply and `runSegment`. Test helpers `TEST_PASS_()`/`REVIEW_PASS_()`/`STEPS_ALL()` are function declarations at the bottom of `flow.test.js` and are hoisted.

**4. Review Focus:** items 1 (late gate), 2 (odd task text and delimiters), 3 (case, unknown step), 4 (null, missing file, Windows path), 5 (failure cleared), 6 (fix-loop edge cases), 7 (dedupe) each map to named checks above.
