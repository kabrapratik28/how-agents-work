// Lesson invariants for the subagent simulator (chapter 07).
export default function (sims, assert) {
  const s = sims['subagents'];
  const KEYS = ['clean', 'failure', 'coupled', 'disagree', 'lost'];
  const CHOICES = { failure: [undefined, 'retry', 'partial', 'ask'], disagree: [undefined, 'confident', 'vote', 'evidence'] };
  const sumCalls = (calls) => calls.reduce((t, c) => t + c.input + c.output, 0);
  const runsOf = (r, pred) => r.agents.filter(pred).flatMap((a) => a.runs);
  const isParent = (a) => a.role === 'parent';
  const parentCtxText = (r) => r.parentContext.blocks.map((b) => b.label + ' ' + (b.text || '')).join('\n');

  assert.deepEqual(s.scenarios.map((x) => x.key), KEYS);

  function* combos() {
    for (const scenario of KEYS) {
      for (const results of ['summaries', 'transcripts']) {
        for (const schedule of ['parallel', 'sequential']) {
          for (const choice of CHOICES[scenario] || [undefined]) {
            for (const flag of [false, true]) {
              yield { scenario, results, schedule, choice, ownership: flag, refs: flag };
            }
          }
        }
      }
    }
  }

  for (const o of combos()) {
    const r = s.run(o);
    const tag = JSON.stringify(o);

    // Accounting counts every call of every agent, failed runs included.
    const allCalls = r.agents.flatMap((a) => a.runs.flatMap((run) => run.calls));
    assert.equal(r.tokens.total, sumCalls(allCalls), tag + ': total counts every call');
    const childRuns = runsOf(r, (a) => !isParent(a));
    const childFinal = childRuns.reduce((t, run) => t + run.calls[run.calls.length - 1].input, 0);
    const orchestration = sumCalls(runsOf(r, isParent).flatMap((run) => run.calls));
    assert.equal(r.tokens.orchestration, orchestration, tag + ': orchestration = the parent calls');
    assert.ok(r.tokens.total >= childFinal + orchestration, tag + ': at least every child context plus orchestration');
    assert.ok(r.tokens.total > childFinal + orchestration, tag + ': re-sent child history is counted too');
    const b = r.tokens.breakdown;
    assert.equal(b.orchestration + b.prefixes + b.briefs + b.rediscovery + b.work, r.tokens.total, tag + ': breakdown partitions the total');
    for (const k of ['orchestration', 'prefixes', 'briefs', 'rediscovery', 'work']) assert.ok(b[k] > 0, tag + ': overhead shown: ' + k);

    // Timing: parallel = slowest task chain, sequential = sum (machine time only).
    const d = r.timing.chains.map((c) => c.duration);
    assert.equal(d.length, 3, tag + ': three delegated tasks');
    if (o.schedule === 'parallel') assert.equal(r.timing.childrenPhase, Math.max(...d), tag + ': parallel = slowest');
    else assert.equal(r.timing.childrenPhase, d.reduce((x, y) => x + y, 0), tag + ': sequential = sum');
    assert.ok(r.timing.wallClock > r.timing.childrenPhase, tag + ': parent calls add time');
    assert.ok(typeof r.timing.assumption === 'string' && r.timing.assumption.length > 20, tag + ': timing assumption stated');
    for (const seg of r.timing.segments) assert.ok(seg.end > seg.start && seg.end <= r.timing.wallClock, tag + ': segments inside the run');

    // The parent context is a list of blocks; its size is their sum.
    assert.equal(r.parentContext.tokens, r.parentContext.blocks.reduce((t, x) => t + x.tokens, 0), tag + ': parent context adds up');
    const ctxIds = new Set(r.parentContext.blocks.flatMap((x) => x.entries || []));
    const returned = childRuns.filter((run) => run.returned);
    assert.ok(returned.length >= 2, tag + ': results come back');
    for (const run of returned) {
      const ids = run.transcript.map((e) => e.id);
      if (o.results === 'transcripts') {
        for (const id of ids) assert.ok(ctxIds.has(id), tag + ': transcript entry in parent context: ' + id);
      } else {
        const inCtx = ids.filter((id) => ctxIds.has(id));
        assert.deepEqual(inCtx, [run.reportId], tag + ': only the report reaches the parent');
      }
    }
    // Each delegate call gets exactly one result in the parent context (or is visibly pending while the run waits).
    const delegateIds = r.parentContext.blocks.filter((x) => x.kind === 'delegate').map((x) => x.callId);
    assert.ok(delegateIds.length >= 3, tag + ': three delegate calls (a verifier adds one)');
    for (const id of delegateIds) {
      const n = r.parentContext.blocks.filter((x) => x.kind === 'result' && x.callId === id).length;
      const pending = r.parentContext.blocks.some((x) => x.kind === 'pending' && x.callId === id);
      if (r.outcome.status === 'waiting' && pending) assert.equal(n, 0, tag + ': pending call has no result yet');
      else assert.equal(n, 1, tag + ': one result for ' + id);
    }
    assert.ok(r.contracts.length === 3 && r.contracts.every((c) => c.objective && c.tools.length && c.output && c.budget && c.owns && c.cancel), tag + ': contracts');
    assert.ok(r.events.length >= 5 && r.outcome && r.outcome.status, tag + ': events and outcome');
  }

  // Transcripts make the parent context much larger; summaries keep it small.
  for (const scenario of KEYS) {
    const sum = s.run({ scenario, results: 'summaries', choice: CHOICES[scenario] && CHOICES[scenario][1] });
    const tr = s.run({ scenario, results: 'transcripts', choice: CHOICES[scenario] && CHOICES[scenario][1] });
    assert.ok(tr.parentContext.tokens > 5 * sum.parentContext.tokens, scenario + ': transcripts flood the parent context');
    assert.ok(tr.tokens.total > sum.tokens.total, scenario + ': and cost more');
  }

  // Coupled edits: two children write the same file and one loses.
  for (const schedule of ['parallel', 'sequential']) {
    const c = s.run({ scenario: 'coupled', schedule });
    assert.ok(c.conflict, schedule + ': a coupled edit shows a conflict');
    const writers = new Set(c.files['app/settings.py'].writes.map((w) => w.by));
    assert.ok(writers.size >= 2, schedule + ': two agents wrote the same file');
    assert.ok(c.conflict.broken.length >= 1 && !c.conflict.broken.includes(c.conflict.winner), schedule + ': the overwritten spike breaks');
    assert.equal(c.outcome.status, 'conflict');
  }
  const owned = s.run({ scenario: 'coupled', ownership: true });
  assert.equal(owned.conflict, null, 'enforced ownership prevents the conflict');
  assert.deepEqual(owned.files['app/settings.py'].writes.map((w) => w.by), ['parent'], 'only the parent writes the shared file');
  assert.ok(owned.events.some((e) => /refuse/i.test(e.text)), 'the runtime refuses writes outside owned paths');

  // A failed child: decide what happens next.
  const f0 = s.run({ scenario: 'failure' });
  assert.equal(f0.outcome.status, 'waiting');
  assert.deepEqual(f0.needsChoice.options.map((x) => x.key), ['retry', 'partial', 'ask']);
  const retry = s.run({ scenario: 'failure', choice: 'retry' });
  const partial = s.run({ scenario: 'failure', choice: 'partial' });
  const ask = s.run({ scenario: 'failure', choice: 'ask' });
  assert.ok(retry.tokens.total > partial.tokens.total, 'a retry costs tokens');
  assert.ok(retry.timing.wallClock > partial.timing.wallClock, 'a retry costs time');
  assert.equal(retry.agents.find((a) => a.id === 'sqs').runs[0].status, 'failed', 'the failed attempt stays on the books');
  assert.equal(partial.outcome.status, 'partial');
  assert.ok(ask.timing.humanWait, 'asking the user blocks on a person');
  assert.equal(retry.outcome.status, 'ok');

  // Disagreement: resolve with evidence, not confidence or votes.
  const d0 = s.run({ scenario: 'disagree' });
  assert.equal(d0.outcome.status, 'waiting');
  assert.ok(d0.disagreement && d0.disagreement.claims.length >= 2);
  const conf = s.run({ scenario: 'disagree', choice: 'confident' });
  const vote = s.run({ scenario: 'disagree', choice: 'vote' });
  const ev = s.run({ scenario: 'disagree', choice: 'evidence' });
  assert.equal(conf.outcome.status, 'risk');
  assert.equal(vote.outcome.status, 'weak');
  assert.equal(ev.outcome.status, 'ok');
  assert.match(ev.outcome.answer, /idempotent/i);
  assert.ok(ev.tokens.total > conf.tokens.total && ev.timing.wallClock > conf.timing.wallClock, 'evidence costs extra');

  // A detail lost in a summary.
  const lost = s.run({ scenario: 'lost' });
  assert.equal(lost.outcome.status, 'risk');
  assert.equal(lost.lostDetail.inParentContext, false);
  assert.ok(!/allkeys-lru/.test(parentCtxText(lost)), 'the summary dropped the detail');
  assert.ok(runsOf(lost, (a) => a.id === 'redis')[0].transcript.some((e) => /allkeys-lru/.test(e.text)), 'the child saw it');
  const lostT = s.run({ scenario: 'lost', results: 'transcripts' });
  assert.equal(lostT.lostDetail.inParentContext, true);
  assert.ok(/allkeys-lru/.test(parentCtxText(lostT)), 'transcripts carry it');
  const lostR = s.run({ scenario: 'lost', refs: true });
  assert.ok(/allkeys-lru/.test(parentCtxText(lostR)), 'a contract that asks for risks keeps it');
  assert.equal(lostR.outcome.status, 'ok');

  // Baselines: subagents are not free.
  const clean = s.run({ scenario: 'clean' });
  const bl = clean.baselines;
  assert.ok(bl.naive.lastContext > clean.parentContext.tokens, 'one agent keeping everything has a bigger context');
  assert.ok(bl.careful.wallClock > clean.timing.wallClock, 'parallel children finish sooner');
  assert.ok(clean.tokens.total > bl.careful.tokens, 'subagents cost more tokens than one careful agent');
  assert.ok(bl.naive.tokens > bl.careful.tokens, 'keeping all history costs the most');
  assert.equal(clean.outcome.status, 'ok');
}
