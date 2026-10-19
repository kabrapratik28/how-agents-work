// Lesson invariants for the memory simulator (chapter 05).
export default function (sims, assert) {
  const m = sims['memory-sim'];
  const keys = ['index', 'reset', 'flaky', 'deploy', 'oncall'];
  assert.deepEqual(Object.keys(m.presets), keys);
  const byId = Object.fromEntries(m.store.map((e) => [e.id, e]));
  const memfile = (r) => r.context.find((b) => b.kind === 'memfile');
  const ids = (r) => r.injected.map((i) => i.id).sort().join(',');
  const cand = (r, id) => r.candidates.find((c) => c.id === id);

  // Every request: the memory file rides along unchanged; retrieved items passed every gate.
  const runs = keys.map((k) => [k, m.retrieve(k)]);
  const file0 = JSON.stringify(memfile(runs[0][1]));
  for (const [k, r] of runs) {
    assert.ok(memfile(r), k + ': memory file is in the context');
    assert.equal(JSON.stringify(memfile(r)), file0, k + ': the memory file does not depend on the request');
    assert.ok(memfile(r).items.length >= 3, k + ': memory file lists the pinned facts');
    let used = 0;
    for (const it of r.injected) {
      const e = byId[it.id];
      assert.equal(e.status, 'accepted', k + ': only accepted memories are injected (' + it.id + ')');
      assert.ok(m.scopes.includes(e.scope), k + ': only in-scope memories are injected (' + it.id + ')');
      assert.ok(!e.pinned, k + ': pinned facts come through the memory file, not retrieval');
      assert.ok(it.source && it.verified, k + ': provenance travels with ' + it.id);
      assert.equal(cand(r, it.id).verdict, 'selected');
      assert.ok(cand(r, it.id).rerank >= m.threshold, k + ': injected items clear the relevance bar');
      used += e.tokens;
    }
    assert.ok(used <= m.budget, k + ': injected memory fits the budget');
    assert.equal(r.used, used);
    assert.equal(Boolean(r.context.find((b) => b.kind === 'retrieved')), r.injected.length > 0,
      k + ': a retrieved block exists only when something was injected');
    const steps = m.build(k);
    assert.equal(steps.length, m.stages.length, k + ': one step per pipeline stage');
    for (const st of steps) assert.ok(st.title && st.say, k + ': every step has a title and narration');
  }
  assert.equal(new Set(runs.map(([, r]) => ids(r))).size, keys.length, 'retrieved items depend on the request');

  // Empty retrieval injects nothing, even though the vector search returned neighbors.
  const on = m.retrieve('oncall');
  assert.ok(on.candidates.length > 0, 'the search still returns its nearest neighbors');
  assert.equal(on.injected.length, 0, 'empty retrieval injects nothing');
  assert.equal(on.used, 0);

  // The wrong-scope item has the top similarity, and the scope filter removes it.
  const ix = m.retrieve('index');
  const my = cand(ix, 'legacy-mysql');
  assert.ok(my, 'the MySQL note comes back from the search');
  assert.equal(my.verdict, 'wrong scope');
  assert.equal(my.vec, Math.max(...ix.candidates.map((c) => c.vec)), 'it has the highest similarity');
  for (const [k, r] of runs) assert.ok(!r.injected.some((i) => i.id === 'legacy-mysql'), k + ': never injected');
  // Category overlap: a structured fact found by similarity search.
  assert.equal(byId.migrations.type, 'fact');
  assert.ok(byId.migrations.key, 'the migrations rule is a keyed fact');
  assert.ok(cand(ix, 'migrations').vec > 0 && cand(ix, 'migrations').verdict === 'selected');

  // Similarity is not relevance; proposals never get in.
  const fl = m.retrieve('flaky');
  assert.ok(cand(fl, 'doc-login').vec > cand(fl, 'ep-flaky').vec, 'the login doc is more similar');
  assert.equal(cand(fl, 'doc-login').verdict, 'below threshold');
  assert.equal(cand(fl, 'ep-flaky').verdict, 'selected', 'the episodic note is the relevant one');
  assert.equal(byId['ep-flaky'].type, 'episode');
  assert.equal(cand(fl, 'prop-redis').verdict, 'not accepted');

  // Relevance is not correctness: a stale fact goes in flagged, never silently.
  const rs = m.retrieve('reset');
  const stale = rs.injected.find((i) => i.id === 'email-ses');
  assert.ok(stale && stale.stale && stale.note, 'the stale fact carries a warning');
  for (const [k, r] of runs) {
    for (const it of r.injected) {
      const changed = m.sourceChanged[it.source];
      assert.equal(it.stale, Boolean(changed && changed > it.verified), k + ': stale exactly when the source changed after verification');
    }
  }

  // The budget forces a choice.
  const dp = m.retrieve('deploy');
  assert.ok(dp.candidates.some((c) => c.verdict === 'over budget'), 'something relevant is cut for budget');
  assert.ok(dp.injected.some((i) => byId[i.id].type === 'procedure'), 'the deploy procedure is retrieved');

  // Write path: proposals are not memory; accepted facts change only with evidence.
  const w = m.write();
  assert.ok(w.steps.length >= 6);
  for (const st of w.steps) assert.ok(st.title && st.say);
  const key = (e) => JSON.stringify([e.text, e.value, e.status]);
  for (let i = 1; i < w.steps.length; i++) {
    const before = Object.fromEntries(w.steps[i - 1].store.map((e) => [e.id, e]));
    const after = Object.fromEntries(w.steps[i].store.map((e) => [e.id, e]));
    for (const id of Object.keys(before)) {
      const changed = !after[id] || key(after[id]) !== key(before[id]);
      if (changed) {
        const ev = w.steps[i].evidence;
        assert.ok(ev && ev.source && ev.says, 'step ' + i + ' changes ' + id + ' without evidence');
      }
    }
    for (const e of w.steps[i].store) assert.ok(!e.secret, 'no secret is ever stored');
  }
  const dec = Object.fromEntries(w.steps.filter((s) => s.proposal).map((s) => [s.proposal, s.decision]));
  assert.deepEqual(dec, { p1: 'accepted', p2: 'rejected', p3: 'replaces', p4: 'unresolved', p5: 'blocked' });
  const fin = Object.fromEntries(w.final.map((e) => [e.id, e]));
  assert.equal(fin['db-engine'].value, 'PostgreSQL 15', 'the authoritative config keeps PostgreSQL');
  assert.ok(!w.final.some((e) => e.value === 'MySQL' && e.scope === 'project' && e.status === 'accepted'));
  assert.equal(fin['py-version'].status, 'superseded', 'the old fact is kept as history, not deleted');
  assert.ok(w.final.some((e) => e.value === 'Python 3.12' && e.status === 'accepted'));
  // The Friday claim is newer than the runbook rule, but newer is not evidence.
  const p4 = w.proposals.find((p) => p.id === 'p4');
  assert.ok(p4.at > fin['deploy-window'].verified, 'the claim is newer');
  assert.equal(fin['deploy-window'].value, 'any weekday', 'the accepted rule stands');
  assert.equal(w.steps[w.steps.length - 1].proposals.find((p) => p.id === 'p4').status, 'unresolved');
  // Evidence must support what is stored: the stored text comes from the evidence, not the proposal.
  const tokens = (v) => v.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)*/g);
  for (let i = 1; i < w.steps.length; i++) {
    const st = w.steps[i];
    if (st.decision !== 'accepted' && st.decision !== 'replaces') continue;
    const before = new Set(w.steps[i - 1].store.map((e) => e.id));
    const added = st.store.filter((e) => !before.has(e.id));
    assert.equal(added.length, 1, 'one new fact per accepted proposal');
    const ev = st.evidence;
    for (const t of tokens(added[0].value)) assert.ok(ev.says.toLowerCase().includes(t), 'evidence "' + ev.says + '" must show "' + t + '"');
    assert.equal(added[0].text, ev.fact, 'stored text is built from the evidence');
    assert.equal(added[0].source, ev.source);
  }
  assert.ok(!w.final.some((e) => /12 minutes/.test(e.text)), 'the unchecked duration is never stored');
  const rejected = w.steps.find((st) => st.decision === 'rejected');
  assert.ok(tokens(fin['db-engine'].value).every((t) => rejected.evidence.says.toLowerCase().includes(t)), 'the evidence backs the existing fact');
  assert.ok(!rejected.evidence.says.toLowerCase().includes('mysql'), 'the evidence does not back the proposal');
  // The next memory file reflects the accepted change.
  const next = m.memoryFile(w.final).map((x) => x.text).join(' ');
  assert.match(next, /3\.12/);
  assert.doesNotMatch(next, /3\.11/);
}
