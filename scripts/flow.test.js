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
