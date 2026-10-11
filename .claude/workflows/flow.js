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

// Every string an agent wrote (blockers, failures, summaries) ends up in the save prompt
// between delimiter lines, so no run of three or more < or > may survive in it.
const clean = (s) => String(s).replace(/<{3,}/g, '<<').replace(/>{3,}/g, '>>');

function savePrompt(cur, report) {
  const base = { flowSchema: 1, task: cur.task };
  const stateJson = clean(JSON.stringify({ ...base, completed: cur.completed, approved: cur.approved, failure: cur.failure }, null, 2));
  // For each completed step that needs a file: the state to write if that file is missing.
  const rollbacks = cur.completed.filter((s) => REQUIRED_ARTIFACTS[s]).map((step) => {
    const kept = cur.completed.slice(0, cur.completed.indexOf(step));
    const rolled = {
      ...base,
      completed: kept,
      approved: cur.approved.filter((a) => kept.includes(a)),
      failure: `${step}: required file ${REQUIRED_ARTIFACTS[step].join(', ')} is missing`,
    };
    return { step, json: clean(JSON.stringify(rolled, null, 2)) };
  });
  const todo = [
    `Check that every step in "completed" of the STATE block has its required file in the repository: ${JSON.stringify(REQUIRED_ARTIFACTS)}.`,
    'Write docs/flow-state.json ONCE (create docs/ if it does not exist). If no required file is missing, write the STATE block exactly as given. If a required file is missing, write instead the ROLLBACK block of the EARLIEST step whose file is missing, exactly as given and never edited. Do not write the file twice.',
  ];
  if (report) {
    todo.push('Put the text of the REPORT block in docs/run-log.md under the heading "## Fix-loop (flow)", replacing the existing section with that heading if there is one.');
  }
  const parts = [
    'Save the state of the flow. Do exactly the numbered tasks and nothing else. Do not commit, do not push and do not change any other file.',
    ...todo.map((t, i) => `${i + 1}. ${t}`),
    'Return savedCompleted (the completed list you actually wrote), failure (the failure text you wrote, empty if none) and missing (the missing required paths, empty if none).',
    '<<<STATE',
    stateJson,
    'STATE>>>',
  ];
  if (report) parts.push('<<<REPORT', clean(report), 'REPORT>>>');
  for (const rb of rollbacks) parts.push(`<<<ROLLBACK ${rb.step}`, rb.json, 'ROLLBACK>>>');
  return parts.join('\n');
}

const STATE_PROMPT = [
  'Read two files in this repository and return their raw text. Do not create, change or delete any file.',
  '- docs/flow-state.json -> stateText (an empty string if the file does not exist)',
  '- docs/flow.config.json -> configText (an empty string if the file does not exist)',
  'Return the text exactly as stored, without commenting on it.',
].join('\n');

const normalizePath = (p) => String(p).replace(/\\/g, '/').replace(/^\.\//, '');

const DELIVER_NOTE = 'The fix-loop of this run ended GREEN: tests passed and the independent review said PASS. Its record is under "## Fix-loop (flow)" in docs/run-log.md.';

function stepPrompt(step, task, extra) {
  const lines = [
    `You are running the "${step}" step of the harness delivery flow.`,
    `Task: ${task}`,
    '',
    `1. Read .claude/commands/${step}.md. It is the instruction for this step. Follow it exactly, and use the task above wherever it refers to $ARGUMENTS.`,
    '2. A workflow runs the human approval gates itself. So do NOT stop to ask the user anything, do NOT wait for approval, and ignore any line that tells you to stop, to ask the user to approve, or to suggest running another command.',
    `3. ${NO_PUSH} Commit only if the step file asks you to, and only on a feature branch.`,
    '4. If docs/run-log.md already has a section for this step, replace it instead of adding a duplicate.',
    '5. Report through the structured result: status "done" (or "failed", with the reason in summary), a one-line summary, and artifacts = the repo-relative paths of the files you wrote or changed. List a path only if the file exists.',
  ];
  if (extra) lines.push(`6. ${extra}`);
  return lines.join('\n');
}

function stepProblem(step, out) {
  if (!out) return 'the agent did not return a result';
  if (out.status !== 'done') return `the agent reported failure: ${out.summary}`;
  const reported = (out.artifacts || []).map(normalizePath);
  const missing = (REQUIRED_ARTIFACTS[step] || []).filter((p) => !reported.includes(p));
  if (missing.length) return `the agent did not report writing ${missing.join(', ')}`;
  return '';
}

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
    rounds.push({ round, testPassed: test.passed === true, command: test.command, verdict: review.verdict, blockers: review.blockers, failures: test.failures });
    if (test.passed === true && test.failures.length === 0 && review.verdict === 'PASS' && review.blockers.length === 0) return { green: true, rounds, reason: '' };
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

const saveAgent = (cur, report) => agent(savePrompt(cur, report), { label: 'save', phase: 'Save', schema: SAVE_SCHEMA, ...TIERS.save });

// null when the save went through; otherwise the failed result to return
function savedProblem(saved) {
  if (!saved) {
    return result('failed', 'The steps ran, but docs/flow-state.json could not be saved (the save agent did not return). Check docs/ before running /flow again.');
  }
  if (saved.missing.length) {
    return result('failed', `Required file(s) missing: ${saved.missing.join(', ')}. ${saved.failure} Run /flow to retry from "${STEPS[saved.savedCompleted.length]}".`, { completed: saved.savedCompleted, failure: saved.failure });
  }
  return null;
}

async function runSegment(start, gates) {
  const cur = { task: start.task, completed: [...start.completed], approved: [...start.approved], failure: '' };
  const reports = [];
  let outcome = 'gate';
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
      const out = await agent(stepPrompt(step, cur.task, step === 'deliver' ? DELIVER_NOTE : undefined), { label: step, phase: 'Steps', schema: STEP_SCHEMA, ...TIERS.step });
      const problem = stepProblem(step, out);
      if (problem) {
        cur.failure = `${step}: ${problem}`;
        outcome = 'failed';
        break;
      }
    }
    cur.completed.push(step);
    if (gates.includes(step)) break;
    if (step === 'fix-loop') {
      // deliver reads the fix-loop record in docs/run-log.md, so write it before deliver runs
      const early = savedProblem(await saveAgent(cur, reports.join('\n')));
      if (early) return early;
      reports.length = 0;
    }
  }

  const saved = await saveAgent(cur, reports.join('\n'));
  const stop = savedProblem(saved);
  if (stop) return stop;
  const done = saved.savedCompleted;
  const retry = STEPS[done.length];
  if (done.length !== cur.completed.length) {
    return result('failed', `The save agent saved ${done.length} step(s) but ${cur.completed.length} were completed; check docs/flow-state.json before running /flow again.`, { completed: done });
  }
  if (outcome === 'failed') {
    return result('failed', `Stopped: ${cur.failure}. Fix the cause, then run /flow to retry from "${retry}".`, { completed: done, failure: cur.failure });
  }
  if (outcome === 'escalated') {
    return result('escalated', `The fix-loop is not green: ${cur.failure.replace(/^fix-loop: /, '')}. See "## Fix-loop (flow)" in docs/run-log.md. Fix it yourself or change the spec, then run /flow to run the fix-loop again.`, { completed: done, failure: cur.failure });
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
