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

  w = fromImplement({ tests: [TEST_PASS_(), TEST_PASS_()], reviews: [BLOCK(), REVIEW_PASS_()] });
  r = await run(w, undefined);
  check('a BLOCK verdict with no listed blockers is not green', loopLabels(r.labels).filter((l) => l.endsWith(':fix')).length === 1 && /round 2/.test(w.reports[0]));

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
function TEST_PASS_() { return require('./lib/flowsim').TEST_PASS; }
function REVIEW_PASS_() { return require('./lib/flowsim').REVIEW_PASS; }
