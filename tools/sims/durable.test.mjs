// Lesson invariants for the crash-and-resume widget (chapter 12).
// build(opts) expands one configuration into steps. opts: mode ('none' | 'checkpoint' | 'idempotent'),
// receiver ('dedup' | 'plain'), crash ('none' | 'fetch_c' | 'after_send'), delay ('now' | '30h'),
// onUnknown ('retry' | 'query' | 'human', the choice made when a send's outcome is unknown).
export default function (sims, assert) {
  const s = sims['durable'];
  const last = (steps) => steps[steps.length - 1];
  const run = (o) => { const steps = s.build(o); return { steps, end: last(steps) }; };
  const sends = (st) => st.gatewayLog.filter((e) => e.type === 'send');
  const base = { mode: 'idempotent', receiver: 'dedup', crash: 'after_send', delay: 'now' };

  function checkCommon(steps, o) {
    assert.ok(steps.length > 3, 'a run has several steps');
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      assert.ok(st.title && st.say && st.log && st.log.text && st.actor, 'step ' + i + ' needs title, narration, actor and a log line');
      if (o.mode === 'none') assert.equal(st.store, null, 'no checkpoint store without checkpoints (step ' + i + ')');
      else assert.ok(st.store && typeof st.store === 'object', 'checkpoint modes always show the store');
      // every delivered email has a gateway record, and nothing else lands in the inbox
      assert.equal(st.inbox.length, sends(st).filter((e) => e.delivered).length, 'inbox matches deliveries (step ' + i + ')');
      if (i) {
        const p = steps[i - 1];
        assert.ok(st.inbox.length >= p.inbox.length, 'an email cannot be unsent');
        assert.ok(st.counters.fetchTotal >= p.counters.fetchTotal && st.counters.model >= p.counters.model, 'counters never shrink');
        assert.ok(st.gatewayLog.length >= p.gatewayLog.length, 'the receiver log only grows');
      }
    }
    const ci = steps.findIndex((st) => st.kind === 'crash');
    if (ci !== -1) {
      assert.deepEqual(steps[ci].memory, {}, 'a crash wipes worker memory');
      if (o.mode !== 'none') assert.deepEqual(steps[ci].store, steps[ci - 1].store, 'a crash never touches the checkpoint store');
      assert.equal(steps[ci + 1].kind, 'restart', 'a restart follows the crash');
    }
  }

  assert.deepEqual(Object.keys(s.options), ['mode', 'receiver', 'crash', 'delay']);

  // No crash: one email, three fetches, one model call, whatever the settings
  for (const mode of ['none', 'checkpoint', 'idempotent']) {
    for (const receiver of ['dedup', 'plain']) {
      const o = { mode, receiver, crash: 'none', delay: 'now' };
      const { steps, end } = run(o);
      checkCommon(steps, o);
      assert.equal(end.kind, 'done');
      assert.equal(end.inbox.length, 1);
      assert.equal(end.counters.fetchTotal, 3);
      assert.equal(end.counters.model, 1);
      assert.ok(!steps.some((st) => st.kind === 'choice'), 'no recovery choice without a crash');
    }
  }

  // No checkpoints: a crash during fetch C replays fetches A and B
  {
    const o = { mode: 'none', receiver: 'dedup', crash: 'fetch_c', delay: 'now' };
    const { steps, end } = run(o);
    checkCommon(steps, o);
    assert.equal(end.counters.fetch.a, 2);
    assert.equal(end.counters.fetch.b, 2);
    assert.ok(end.counters.fetchTotal > 3, 'replayed fetches');
    assert.equal(end.inbox.length, 1, 'nothing was sent before the crash');
  }
  // With checkpoints, only the fetch that was in flight runs again
  for (const mode of ['checkpoint', 'idempotent']) {
    const o = { mode, receiver: 'dedup', crash: 'fetch_c', delay: 'now' };
    const { steps, end } = run(o);
    checkCommon(steps, o);
    assert.equal(end.counters.fetch.a, 1);
    assert.equal(end.counters.fetch.b, 1);
    assert.equal(end.counters.fetch.c, 2);
    assert.equal(end.counters.model, 1);
    assert.equal(end.inbox.length, 1);
  }

  // No checkpoints, crash after the send: everything reruns, including the model call, and a different second email goes out
  for (const receiver of ['dedup', 'plain']) {
    const o = { mode: 'none', receiver, crash: 'after_send', delay: 'now' };
    const { steps, end } = run(o);
    checkCommon(steps, o);
    assert.equal(end.counters.fetchTotal, 6);
    assert.equal(end.counters.model, 2, 'the model is called again, not replayed');
    assert.equal(end.inbox.length, 2, 'duplicate email');
    assert.notEqual(end.inbox[0].body, end.inbox[1].body, 'a second model call can word the summary differently');
  }

  // Checkpoints alone do not stop the duplicate: nothing recorded the send, and the key was never persisted
  for (const receiver of ['dedup', 'plain']) {
    const o = { mode: 'checkpoint', receiver, crash: 'after_send', delay: 'now' };
    const { steps, end } = run(o);
    checkCommon(steps, o);
    assert.equal(end.counters.fetchTotal, 3, 'no replayed fetches');
    assert.equal(end.counters.model, 1, 'the recorded summary is replayed, not regenerated');
    assert.equal(end.inbox.length, 2, 'duplicate email');
    assert.equal(end.inbox[0].body, end.inbox[1].body, 'same content, sent twice');
    const k = sends(end).map((e) => e.key);
    assert.equal(k.length, 2);
    assert.notEqual(k[0], k[1], 'a key generated at send time is lost with the worker');
    assert.ok(!steps.some((st) => st.kind === 'choice'), 'the runtime does not even know it tried');
  }

  // Operation id persisted before the first attempt: the restart finds the outcome unknown and must choose
  {
    const { steps, end } = run(base);
    checkCommon(steps, base);
    assert.equal(end.kind, 'choice');
    assert.equal(end.choice.length, 3);
    assert.equal(end.sendState, 'outcome unknown');
    assert.equal(end.store.send.state, 'outcome unknown');
    assert.equal(end.inbox.length, 1, 'nothing is resent while the runtime decides');
    // the record exists, and says attempted, before the gateway ever sees the request
    const first = steps.findIndex((st) => st.gatewayLog.length > 0);
    assert.ok(first > 0);
    assert.equal(steps[first].store.send.state, 'attempted');
    assert.equal(steps[first].store.send.op_id, steps[first].gatewayLog[0].key);
    assert.ok(steps.findIndex((st) => st.store.send && st.store.send.state === 'intended') < first, 'intended is recorded first');
  }

  // Idempotency key plus a deduplicating receiver: exactly one email after a crash after the send
  {
    const o = { ...base, onUnknown: 'retry' };
    const { steps, end } = run(o);
    checkCommon(steps, o);
    assert.equal(end.kind, 'done');
    assert.equal(end.inbox.length, 1, 'exactly one email');
    assert.equal(end.sendState, 'confirmed');
    const sd = sends(end);
    assert.equal(sd.length, 2);
    assert.equal(sd[0].key, sd[1].key, 'the persisted key is reused after the restart');
    assert.equal(sd[1].delivered, false, 'the receiver deduplicates the retry');
    const states = steps.map((st) => st.sendState).filter((x, i, a) => x && x !== a[i - 1]);
    assert.deepEqual(states, ['intended', 'attempted', 'outcome unknown', 'confirmed']);
  }

  // Without receiver deduplication, the same crash produces a duplicate unless the runtime reconciles
  {
    const o = { ...base, receiver: 'plain', onUnknown: 'retry' };
    const { steps, end } = run(o);
    checkCommon(steps, o);
    assert.equal(end.inbox.length, 2, 'a retry duplicates when the receiver ignores keys');
    for (const r of ['query', 'human']) {
      const o2 = { ...base, receiver: 'plain', onUnknown: r };
      const res = run(o2);
      checkCommon(res.steps, o2);
      assert.equal(res.end.inbox.length, 1, 'reconciling (' + r + ') avoids the duplicate');
      assert.equal(res.end.sendState, 'confirmed');
      assert.equal(sends(res.end).length, 1, 'nothing is resent after reconciling');
    }
  }

  // Resuming after the receiver's retention window can duplicate; reconciling still works
  {
    const o = { ...base, delay: '30h', onUnknown: 'retry' };
    const { steps, end } = run(o);
    checkCommon(steps, o);
    assert.equal(end.inbox.length, 2, 'the key expired after 24 hours');
    assert.equal(sends(end)[1].delivered, true);
    assert.equal(run({ ...base, delay: '30h', onUnknown: 'query' }).end.inbox.length, 1);
    assert.equal(run({ ...base, delay: 'now', onUnknown: 'retry' }).end.inbox.length, 1, 'inside the window the retry is safe');
  }
}
