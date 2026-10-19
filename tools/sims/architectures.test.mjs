// Lesson invariants for the architecture explorer (chapter 14).
export default function (sims, assert) {
  const s = sims['architectures'];
  const ARCHS = ['single', 'planner', 'manager', 'hierarchical', 'graph', 'event-driven', 'combined'];
  const CONDS = ['research', 'coupled', 'event', 'approval'];
  const VERDICTS = ['helps', 'neutral', 'hurts'];
  const ACTORS = ['user', 'model', 'runtime', 'tool', 'human', 'event'];
  const DIMS = ['control', 'delegation', 'trigger', 'durability'];
  const PERSON_STARTED = ['single', 'planner', 'manager', 'hierarchical'];

  assert.deepEqual(s.architectures.map((a) => a.key), ARCHS);
  assert.deepEqual(s.conditions.map((c) => c.key), CONDS);
  for (const a of s.architectures) {
    assert.ok(a.label && a.preset, a.key + ' needs a label and a preset (trigger and durability are separate choices)');
    for (const d of DIMS) assert.ok(typeof a.dims[d] === 'string' && a.dims[d].length > 10, a.key + ' needs dimension ' + d);
  }
  for (const c of s.conditions) assert.ok(c.label && c.task, c.key + ' needs a label and a task');

  const v = (a, c) => s.view(a, c);
  const firstIdx = (trace, pred) => trace.findIndex(pred);
  const isModel = (st) => st.actor === 'model';

  // Every pair: a verdict, a reason, an authored trace, and a picture whose highlights exist.
  for (const a of ARCHS) {
    for (const c of CONDS) {
      const x = v(a, c);
      const where = a + ' x ' + c;
      assert.ok(VERDICTS.includes(x.verdict), where + ': verdict must be helps, neutral, or hurts');
      assert.ok(typeof x.reason === 'string' && x.reason.length > 40, where + ': needs a reason');
      assert.ok(Array.isArray(x.trace) && x.trace.length >= 4, where + ': needs a trace');
      const ids = new Set(x.picture.nodes.map((n) => n.id));
      assert.deepEqual(x.picture.nodes.filter((n) => n.role === 'model').map((n) => n.id), ['model'], where + ': only the Model node is drawn as the model');
      for (const st of x.trace) {
        assert.ok(ACTORS.includes(st.actor), where + ': unknown actor ' + st.actor);
        assert.ok(typeof st.text === 'string' && st.text.length > 3, where + ': every step needs text');
        assert.ok(st.nodes.length && st.nodes.every((n) => ids.has(n)), where + ': every step highlights nodes that are in the picture: ' + st.text);
        if (isModel(st)) {
          assert.ok(st.who, where + ': every model call names its agent');
          assert.ok(st.nodes.includes('model'), where + ': a model call lights the Model node');
        }
      }
      const modelSteps = x.trace.filter(isModel);
      assert.equal(x.calls, modelSteps.length, where + ': displayed calls equal the model-call steps');
      assert.equal(s.modelCalls(x.trace), modelSteps.length);
      assert.ok(x.calls >= 1, where + ': at least one model call');
      assert.match(x.label, new RegExp('^' + x.calls + ' model calls? \\(illustrative\\)$'), where + ': label shows the count');
      assert.deepEqual(modelSteps.map((st) => st.call), modelSteps.map((_, i) => i + 1), where + ': model calls are numbered in order');
    }
  }

  // Not a ranking: every shape's verdict changes with the situation, and every situation has a fit and a misfit.
  for (const a of ARCHS) assert.ok(new Set(CONDS.map((c) => v(a, c).verdict)).size > 1, a + ' has the same verdict everywhere');
  for (const c of CONDS) {
    const vs = ARCHS.map((a) => v(a, c).verdict);
    assert.ok(vs.includes('helps') && vs.some((x) => x !== 'helps'), c + ' needs shapes that help and shapes that do not');
  }

  // Delegation costs calls: splitting the same work across agents uses more model calls than one agent.
  for (const c of CONDS) {
    for (const a of ['manager', 'hierarchical']) assert.ok(v(a, c).calls > v('single', c).calls, a + ' x ' + c + ' should cost more calls than a single agent');
  }

  // Separate research tasks: every shape reports the same literal search result; a code-owned fan-out is cheapest.
  const results = ARCHS.map((a) => v(a, 'research').trace.filter(isModel).pop().text);
  assert.equal(new Set(results).size, 1, 'every shape reports the same result for the same search');
  const mr = v('manager', 'research');
  assert.equal(mr.verdict, 'helps');
  assert.ok(new Set(mr.trace.filter((st) => /^Worker/.test(st.who || '')).map((st) => st.who)).size >= 3, 'three workers');
  assert.ok(v('graph', 'research').calls < mr.calls, 'code fan-out is cheaper than a manager');

  // Edits that depend on each other: a conflict appears exactly when the work is split across writers.
  for (const a of ARCHS) {
    const x = v(a, 'coupled');
    assert.equal(x.trace.some((st) => st.flag === 'conflict'), x.verdict === 'hurts', a + ': hurts exactly when the trace shows a conflict');
  }
  for (const a of ['single', 'combined']) assert.notEqual(v(a, 'coupled').verdict, 'hurts', a + ' keeps one writer');

  // No trace opens a pull request on its own: a pull request is always left as a pending, approval-gated request.
  for (const a of ARCHS) {
    for (const c of CONDS) {
      for (const st of v(a, c).trace) assert.ok(!/opens? (the|a|one) pull request/i.test(st.text), a + ' x ' + c + ' publishes without approval: ' + st.text);
    }
  }

  // An outside event: every overnight run stops at "fix ready, approval requested".
  for (const a of ARCHS) {
    const t = v(a, 'event').trace;
    assert.equal(t[0].actor, 'event', a + ': the event comes first');
    const human = firstIdx(t, (st) => st.actor === 'human');
    assert.equal(human !== -1 && human < firstIdx(t, isModel), PERSON_STARTED.includes(a), a + ': a person starts the run only in person-started shapes');
    if (PERSON_STARTED.includes(a)) {
      assert.ok(t.some((st) => st.flag === 'delay'), a + ': shows the delay');
      assert.equal(v(a, 'event').verdict, 'hurts');
    }
    const last = t[t.length - 1];
    assert.equal(last.flag, 'approval', a + ': the run ends by asking for approval');
    assert.equal(last.req && last.req.action, 'open pull request', a + ': the exact pull request is saved as a pending request');
  }
  const ed = v('event-driven', 'event').trace;
  assert.ok(ed.some((st) => st.flag === 'dedupe'), 'a second copy of the webhook is detected');
  assert.equal(ed.filter((st) => st.starts).length, 1, 'two copies of one webhook start exactly one run');

  // An approval wait: nothing runs while waiting, the approval must match the pending request, and only a saved wait helps.
  for (const a of ARCHS) {
    const x = v(a, 'approval');
    const t = x.trace;
    const gate = firstIdx(t, (st) => st.flag === 'wait' || st.flag === 'checkpoint');
    const human = firstIdx(t, (st) => st.actor === 'human');
    assert.ok(gate > 0 && human > gate, a + ': the gate comes before the human decision');
    assert.ok(!t.slice(gate, human).some((st) => st.actor === 'tool'), a + ': nothing executes while waiting');
    assert.ok(t[gate].req && s.canResume(t[gate].req, t[human].approves), a + ': the approval is for the exact pending request');
    const resume = firstIdx(t, (st) => st.resumes === t[gate].req.id);
    const run = firstIdx(t.slice(human), (st) => st.actor === 'tool') + human;
    assert.ok(resume > human && resume < run, a + ': the request runs only after the approval is matched');
    assert.equal(x.verdict === 'helps', t[gate].flag === 'checkpoint', a + ': helps exactly when the wait is saved');
  }

  // Approval identity: a decision resumes only the exact request it was given for.
  const req = { id: 'req-0042', action: 'alembic upgrade head', target: 'staging' };
  assert.equal(s.canResume(req, { id: 'req-0042', action: 'alembic upgrade head', target: 'staging' }), true);
  assert.equal(s.canResume(req, { id: 'req-0043', action: 'alembic upgrade head', target: 'staging' }), false, 'a different request');
  assert.equal(s.canResume(req, { id: 'req-0042', action: 'alembic upgrade head', target: 'production' }), false, 'same id, different target');
  assert.equal(s.canResume(req, { id: 'req-0042', action: 'alembic downgrade base', target: 'staging' }), false, 'same id, different action');
  assert.equal(s.canResume(req, null), false, 'no decision yet');

  // The crash window around publishing an approved pull request.
  const crashes = ['none', 'after-intent', 'after-attempt', 'after-send'];
  const receivers = [
    { key: true, dedupes: true, withinRetention: true },
    { key: true, dedupes: true, withinRetention: false },
    { key: true, dedupes: false, withinRetention: true, lookupLags: true },
    { key: true, dedupes: false, withinRetention: true, lookupLags: false }
  ];
  for (const crash of crashes) {
    for (const r of receivers) {
      const out = s.publish(Object.assign({ crash: crash, policy: 'safe' }, r));
      assert.equal(out.prs, 1, 'the safe policy opens exactly one pull request: ' + crash + ' ' + JSON.stringify(r));
      assert.equal(out.state, 'confirmed');
      if (crash === 'after-attempt' || crash === 'after-send') assert.ok(out.states.includes('outcome unknown'), 'a crash after the attempt leaves the outcome unknown until checked');
    }
  }
  assert.equal(s.publish({ crash: 'after-send', policy: 'blind-retry', key: false }).prs, 2, 'a blind retry after a crash duplicates');
  assert.equal(s.publish({ crash: 'after-send', policy: 'key-retry', key: true, dedupes: true, withinRetention: false }).prs, 2, 'a key does not help after the retention window');
  assert.equal(s.publish({ crash: 'after-send', policy: 'lookup-then-send', key: true, dedupes: false, lookupLags: true }).prs, 2, 'a lookup that lags is not proof that nothing happened');
  assert.equal(s.publish({ crash: 'after-intent', policy: 'blind-retry', key: false }).prs, 1, 'before the attempt, nothing was sent, so sending is safe');
}
