// Lesson invariants for the step-through agent loop (chapter 01, reused in 09 and 11).
export default function (sims, assert) {
  const s = sims['agent-loop'];
  const last = (steps) => steps[steps.length - 1];
  const CONTEXT_KINDS = ['context', 'model', 'propose'];

  function checkIds(msgs) {
    const ids = new Set();
    for (const m of msgs) {
      if (m.role === 'assistant' && m.call) ids.add(m.call.id);
      if (m.role === 'tool') assert.ok(ids.has(m.tool_call_id), 'tool result without an earlier call: ' + m.tool_call_id);
    }
  }
  function checkCommon(steps) {
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      assert.ok(st.title && st.say && st.log && st.log.text, 'step ' + i + ' needs title, narration and a log line');
      assert.ok(Array.isArray(st.nodes) && st.nodes.length, 'step ' + i + ' needs nodes to highlight');
      if (CONTEXT_KINDS.includes(st.kind)) assert.ok(Array.isArray(st.context) && st.context.length, 'step ' + i + ' shows the context');
      else assert.equal(st.context, null, 'no context outside a model call (step ' + i + ', ' + st.kind + ')');
      if (i) {
        assert.ok(st.counters.totalTokens >= steps[i - 1].counters.totalTokens, 'total tokens never shrink');
        const dc = st.counters.modelCalls - steps[i - 1].counters.modelCalls;
        assert.equal(dc, ['model', 'propose'].includes(st.kind) ? 1 : 0, 'model calls only grow on model steps');
      }
    }
  }

  assert.deepEqual(Object.keys(s.scenarios), ['answer', 'coding', 'approval']);

  // (a) answer from knowledge: one call, no tools, the runtime stops
  const a = s.build('answer');
  checkCommon(a);
  assert.equal(last(a).counters.modelCalls, 1);
  assert.equal(last(a).counters.toolCalls, 0);
  assert.equal(last(a).state.status, 'done');

  // (b) failing test: four tool calls; propose, stop, verify are separate
  const b = s.build('coding');
  checkCommon(b);
  assert.equal(last(b).counters.toolCalls, 4);
  assert.equal(last(b).state.status, 'done');
  assert.match(last(b).state.last_test, /passed/);
  for (const k of ['propose', 'stop', 'verify']) assert.ok(b.some((st) => st.kind === k), 'coding has a ' + k + ' step');
  assert.ok(b.findIndex((st) => st.kind === 'propose') < b.findIndex((st) => st.kind === 'stop'));
  assert.ok(b.findIndex((st) => st.kind === 'stop') < b.findIndex((st) => st.kind === 'verify'));
  checkIds(last(b).state.messages);
  // the whole history is re-sent: each context is larger than the previous one
  const ctx = b.filter((st) => st.kind === 'context').map((st) => st.counters.ctxTokens);
  for (let i = 1; i < ctx.length; i++) assert.ok(ctx[i] > ctx[i - 1], 'context grows call by call');

  // (c) dangerous action: nothing runs before the decision
  const c0 = s.build('approval', {});
  checkCommon(c0);
  assert.equal(last(c0).kind, 'choice');
  assert.ok(last(c0).choice && last(c0).choice.length === 2);
  assert.ok(!last(c0).executed.some((e) => /DROP/.test(e)), 'nothing executes while waiting');
  assert.ok(c0.some((st) => st.kind === 'blocked'), 'policy blocks the call first');
  const cp = c0.find((st) => st.kind === 'checkpoint');
  assert.ok(cp && cp.state.pending && cp.state.status === 'waiting_for_approval', 'pending call is checkpointed');

  // reject: the DROP never executes; the replacement gets its own policy check
  const rej = s.build('approval', { gate: 'reject' });
  checkCommon(rej);
  assert.ok(!rej.some((st) => st.executed.some((e) => /DROP/.test(e))), 'a rejected call never executes');
  assert.ok(last(rej).executed.some((e) => /^archive_table/.test(e)));
  assert.ok(rej.some((st) => st.kind === 'act' && /archive_table/.test(st.log.text) && /check/i.test(st.say)),
    'the replacement call is policy-checked before it runs');
  const rmsgs = last(rej).state.messages;
  const dropCall = rmsgs.find((m) => m.role === 'assistant' && m.call && m.call.name === 'run_sql');
  const dropResult = rmsgs.find((m) => m.role === 'tool' && m.tool_call_id === dropCall.call.id);
  assert.match(dropResult.text, /reject/i, 'the rejection is the tool result for the original call');
  checkIds(rmsgs);

  // approve: executes exactly the approved call
  const app = s.build('approval', { gate: 'approve' });
  checkCommon(app);
  const pending = app.find((st) => st.kind === 'checkpoint').state.pending;
  assert.deepEqual(last(app).executed, ['run_sql: ' + pending.args.sql]);
  checkIds(last(app).state.messages);
}
