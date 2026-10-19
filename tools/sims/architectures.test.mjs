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
    assert.ok(a.label && a.shape, a.key + ' needs a label and a shape line');
    for (const d of DIMS) assert.ok(typeof a.dims[d] === 'string' && a.dims[d].length > 10, a.key + ' needs dimension ' + d);
  }
  for (const c of s.conditions) assert.ok(c.label && c.task, c.key + ' needs a label and a task');

  const v = (a, c) => s.view(a, c);
  const firstIdx = (trace, pred) => trace.findIndex(pred);
  const isModel = (st) => st.actor === 'model';

  // Every pair: a verdict, a reason, and an authored trace whose call count comes from the trace.
  for (const a of ARCHS) {
    for (const c of CONDS) {
      const x = v(a, c);
      const where = a + ' x ' + c;
      assert.ok(VERDICTS.includes(x.verdict), where + ': verdict must be helps, neutral, or hurts');
      assert.ok(typeof x.reason === 'string' && x.reason.length > 40, where + ': needs a reason');
      assert.ok(Array.isArray(x.trace) && x.trace.length >= 5, where + ': needs a trace');
      for (const st of x.trace) {
        assert.ok(ACTORS.includes(st.actor), where + ': unknown actor ' + st.actor);
        assert.ok(typeof st.text === 'string' && st.text.length > 3, where + ': every step needs text');
        if (isModel(st)) assert.ok(st.who, where + ': every model call names its agent');
      }
      const modelSteps = x.trace.filter(isModel);
      assert.equal(x.calls, modelSteps.length, where + ': displayed calls equal the model-call steps');
      assert.equal(s.modelCalls(x.trace), modelSteps.length);
      assert.ok(x.calls >= 1, where + ': at least one model call');
      assert.match(x.label, new RegExp('^' + x.calls + ' model calls? \\(illustrative\\)$'), where + ': label shows the count');
      assert.equal(x.byAgent.reduce((n, b) => n + b.calls, 0), x.calls, where + ': per-agent counts add up');
      assert.deepEqual(modelSteps.map((st) => st.call), modelSteps.map((_, i) => i + 1), where + ': model calls are numbered in order');
      assert.deepEqual(x.others.map((o) => o.key), CONDS);
      assert.equal(x.others.find((o) => o.key === c).verdict, x.verdict);
    }
  }

  // Not a ranking: every shape's verdict changes with the condition, and every condition has a fit and a misfit.
  for (const a of ARCHS) {
    const set = new Set(CONDS.map((c) => v(a, c).verdict));
    assert.ok(set.size > 1, a + ' has the same verdict everywhere');
  }
  for (const c of CONDS) {
    const vs = ARCHS.map((a) => v(a, c).verdict);
    assert.ok(vs.includes('helps') && vs.some((x) => x !== 'helps'), c + ' needs shapes that help and shapes that do not');
  }

  // Delegation costs calls: splitting work across agents always uses more model calls than one agent.
  for (const c of CONDS) {
    for (const a of ['manager', 'hierarchical']) assert.ok(v(a, c).calls > v('single', c).calls, a + ' x ' + c + ' should cost more calls than a single agent');
  }

  // Independent research: workers fan out; a code-owned fan-out spends fewer calls than a manager deciding the split.
  const mr = v('manager', 'research');
  assert.equal(mr.verdict, 'helps');
  assert.ok(new Set(mr.trace.filter((st) => /^Worker/.test(st.who || '')).map((st) => st.who)).size >= 3, 'three workers');
  assert.ok(v('graph', 'research').calls < mr.calls, 'code fan-out is cheaper than a manager');

  // Coupled edits: a conflict appears exactly when the work is split across writers, and that is when it hurts.
  for (const a of ARCHS) {
    const x = v(a, 'coupled');
    const conflict = x.trace.some((st) => st.flag === 'conflict');
    assert.equal(conflict, x.verdict === 'hurts', a + ': coupled verdict hurts exactly when the trace shows a conflict');
  }
  for (const a of ['single', 'combined']) assert.notEqual(v(a, 'coupled').verdict, 'hurts', a + ' keeps one writer');

  // An external event: person-started shapes wait for a person; event-started ones run at once.
  for (const a of ARCHS) {
    const t = v(a, 'event').trace;
    assert.equal(t[0].actor, 'event', a + ': the event comes first');
    const humanBeforeModel = firstIdx(t, (st) => st.actor === 'human') !== -1 && firstIdx(t, (st) => st.actor === 'human') < firstIdx(t, isModel);
    assert.equal(humanBeforeModel, PERSON_STARTED.includes(a), a + ': a person starts the run only in person-started shapes');
    if (PERSON_STARTED.includes(a)) {
      assert.ok(t.some((st) => st.flag === 'delay'), a + ': shows the delay');
      assert.equal(v(a, 'event').verdict, 'hurts');
    }
  }
  const ed = v('event-driven', 'event').trace;
  const dd = firstIdx(ed, (st) => st.flag === 'dedupe');
  assert.ok(dd > 0, 'a repeated delivery is detected');
  assert.ok(!ed.slice(dd).some(isModel), 'a repeated delivery runs no model call');

  // An approval wait: nothing runs while waiting; a durable wait helps, a wait held in memory does not.
  for (const a of ARCHS) {
    const x = v(a, 'approval');
    const t = x.trace;
    const gate = firstIdx(t, (st) => st.flag === 'wait' || st.flag === 'checkpoint');
    const human = firstIdx(t, (st) => st.actor === 'human');
    assert.ok(gate > 0 && human > gate, a + ': the gate comes before the human decision');
    assert.ok(!t.slice(gate, human).some((st) => st.actor === 'tool'), a + ': nothing executes while waiting');
    assert.ok(t.slice(human).some((st) => st.actor === 'tool'), a + ': the approved action runs after the decision');
    const durable = t[gate].flag === 'checkpoint';
    assert.equal(x.verdict === 'helps', durable, a + ': helps exactly when the wait is checkpointed');
  }
}
