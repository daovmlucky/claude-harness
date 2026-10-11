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
const STEP_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['done', 'failed'] },
    summary: { type: 'string' },
    artifacts: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'summary', 'artifacts'],
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
