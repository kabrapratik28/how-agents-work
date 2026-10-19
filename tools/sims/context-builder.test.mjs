// Lesson invariants for the context builder (chapter 04).
export default function (sims, assert) {
  const s = sims['context-builder'];
  const cfg = (over) => Object.assign(s.defaults(), over || {});
  const run = (over) => s.build(cfg(over));
  const probe = (r, key) => {
    const p = r.probes.find((x) => x.key === key);
    assert.ok(p, 'probe ' + key + ' exists');
    return p;
  };
  const sum = (blocks) => blocks.reduce((a, b) => a + b.tokens, 0);
  const STATES = ['in', 'tool', 'search', 'none'];

  // Shape: occupancy is the sum of what is sent; the latest user message is always sent.
  const d = run();
  assert.equal(d.occupancy, sum(d.blocks));
  assert.equal(d.usable, d.window - s.RESERVE, 'the reply budget is reserved up front');
  assert.equal(d.fits, d.occupancy <= d.usable);
  for (const p of d.probes) assert.ok(STATES.includes(p.state), 'probe state ' + p.state);
  const bare = run({ system: false, agents: false, skillsIndex: false, memory: false, subagent: false, files: 'none', history: 0 });
  assert.ok(bare.blocks.some((b) => b.key === 'user'), 'the latest user message is always on');
  assert.ok(bare.warnings.some((w) => w.key === 'no-system') && bare.warnings.some((w) => w.key === 'no-history'));

  // The default is Patch v3 ("send everything"): it fits, but it is nearly full.
  assert.ok(d.fits && d.pct >= s.NEARLY_FULL, 'default is nearly full: ' + d.pct);
  assert.ok(d.warnings.some((w) => w.key === 'nearly-full'));
  assert.ok(d.warnings.some((w) => w.key === 'stale-read'), 'an old read of the fixed file is in view');

  // Budget pressure: every tool, or a directory dump, overflows the default window. A bigger window fits.
  const allTools = run({ tools: 'all' });
  assert.ok(!allTools.fits && allTools.warnings.some((w) => w.key === 'overflow') && allTools.warnings.some((w) => w.key === 'tools'));
  const dump = run({ files: 'dump' });
  assert.ok(!dump.fits && dump.warnings.some((w) => w.key === 'dump'));
  assert.ok(run({ files: 'dump', tools: 'all', window: 1000000 }).fits);
  assert.ok(!run({ window: 32000 }).fits);

  // Warm caching leaves occupancy unchanged: every request sends the same input tokens.
  for (const r of [d, run({ compacted: true }), run({ change: 'timestamp' }), run({ change: 'compaction' }), allTools]) {
    for (const k of ['cold', 'warm', 'changed']) {
      assert.equal(r.cost[k].cached + r.cost[k].uncached, r.occupancy, k + ' sends exactly the context');
      assert.equal(r.cost[k].output, r.cost.output);
    }
    assert.equal(r.cost.cold.cached, 0, 'a cold request reuses nothing');
    assert.ok(r.cost.warm.cached > 0 && r.cost.warm.units < r.cost.cold.units, 'a warm request is cheaper');
    assert.ok(r.cost.changed.cached <= r.cost.warm.cached && r.cost.changed.units >= r.cost.warm.units);
  }
  // A policy update deliberately invalidates the cache from AGENTS.md onward.
  const tok = (r, key) => r.blocks.find((b) => b.key === key).tokens;
  assert.equal(d.cost.changed.cached, tok(d, 'system') + tok(d, 'tools'));
  assert.equal(run({ change: 'timestamp' }).cost.changed.cached, 0, 'a timestamp at the top makes every call cold');
  // An update to a block that is not sent changes nothing that is sent.
  const noAgents = run({ agents: false });
  assert.equal(noAgents.cost.changed.cached, noAgents.cost.warm.cached);
  // Caching never makes room: fitting depends on occupancy only.
  assert.equal(run({ tools: 'all', change: 'timestamp' }).fits, allTools.fits);

  // Clearing old tool outputs: smaller, every call keeps exactly one result, placeholders point to the full text.
  const cl = run({ cleared: true });
  assert.ok(cl.occupancy < d.occupancy);
  assert.equal(cl.pairs.length, d.pairs.length, 'no call loses its result');
  const calls = new Set(cl.pairs.map((p) => p.id));
  assert.equal(calls.size, cl.pairs.length, 'one result per call');
  const holders = cl.pairs.filter((p) => p.result === 'placeholder');
  assert.ok(holders.length > 0);
  for (const p of holders) assert.ok(p.ref && p.ref.includes(p.id), 'placeholder ' + p.id + ' references its artifact');
  for (const p of cl.pairs.filter((x) => x.step > s.STEPS - s.RECENT)) assert.equal(p.result, 'full', 'recent outputs stay');
  assert.deepEqual(cl.log, d.log, 'clearing changes the view, not the log');
  assert.ok(!cl.warnings.some((w) => w.key === 'stale-read'), 'clearing removes the stale read');

  // Compaction: lower occupancy, the runtime log keeps everything, recent steps stay verbatim.
  for (const quality of ['careful', 'careless']) {
    const c = run({ compacted: true, summary: quality });
    assert.ok(c.occupancy < d.occupancy, 'compaction lowers occupancy');
    assert.ok(c.occupancy < cl.occupancy, 'a summary is smaller than placeholders');
    assert.equal(c.log.steps, d.log.steps);
    assert.equal(c.log.tokens, d.log.tokens, 'originals stay in the session log');
    assert.equal(c.log.compactions, 1);
    assert.ok(c.blocks.some((b) => b.key === 'summary') && c.summaryText);
    assert.equal(c.history.verbatim, s.RECENT);
    assert.equal(c.pairs.length, s.RECENT, 'only whole steps are kept');
    assert.ok(c.pairs.every((p) => p.result === 'full'));
  }
  assert.equal(run({ compacted: true, history: 10 }).history.verbatim, s.RECENT, 'the slider is ignored once compacted');

  // Probe: the user's constraint. A careful summary keeps it; a careless one loses it.
  assert.equal(probe(d, 'constraint').state, 'in');
  assert.equal(probe(run({ compacted: true, summary: 'careful' }), 'constraint').state, 'in');
  const lost = probe(run({ compacted: true, summary: 'careless' }), 'constraint');
  assert.equal(lost.state, 'none', 'a careless summary drops the constraint');
  assert.match(lost.why, /log[\s\S]*outside the workspace/, 'and no tool can reach the log');
  assert.equal(probe(run({ history: 20 }), 'constraint').state, 'none', 'step 14 outside the window');
  assert.equal(probe(run({ cleared: true }), 'constraint').state, 'in', 'clearing never touches user messages');

  // Probe: the original failure, in an old tool output.
  assert.equal(probe(d, 'failure').state, 'in');
  assert.equal(probe(cl, 'failure').state, 'tool', 'a placeholder plus read_file makes it retrievable');
  assert.equal(probe(run({ compacted: true, summary: 'careful' }), 'failure').state, 'in');
  // Not pointed to is not the same as unreachable: the saved log is in the workspace, so a search can find it.
  assert.equal(probe(run({ compacted: true, summary: 'careless' }), 'failure').state, 'search');
  assert.equal(probe(run({ history: 6 }), 'failure').state, 'search');

  // Probe: a fresh observation needs a tool call by design, in every configuration.
  const configs = [d, cl, allTools, dump, bare, run({ compacted: true }), run({ compacted: true, summary: 'careless' }),
    run({ history: 0 }), run({ window: 1000000, files: 'dump', skillBody: true })];
  for (const r of configs) assert.equal(probe(r, 'suite').state, 'tool', 'no evidence can exist before the run');
  assert.ok(probe(d, 'suite').stale, 'the older passing run is flagged as stale evidence');
  assert.equal(probe(run({ history: 2 }), 'suite').stale, null);

  // Probes: instructions, skills, subagent results.
  assert.equal(probe(d, 'changelog').state, 'in');
  assert.equal(probe(noAgents, 'changelog').state, 'search', 'AGENTS.md is a file a search can find');
  assert.equal(probe(run({ agents: false, tools: 'none' }), 'changelog').state, 'none', 'searching needs a tool');
  assert.equal(probe(d, 'deploy').state, 'tool', 'the skills index is a pointer');
  assert.equal(probe(run({ skillBody: true }), 'deploy').state, 'in');
  assert.equal(probe(run({ skillsIndex: false }), 'deploy').state, 'search');
  assert.equal(probe(d, 'callers').state, 'in');
  assert.equal(probe(run({ subagent: false }), 'callers').state, 'tool');

  // Narration: one plain message that names the most important consequence of the current choices.
  for (const r of configs) assert.ok(typeof r.say === 'string' && r.say.length > 20, 'every state has a narration');
  assert.match(allTools.say, /does not fit/i);
  assert.match(run({ compacted: true, summary: 'careless' }).say, /rule/);
  assert.match(cl.say, /placeholder/);
  assert.match(d.say, /86% full/);
  assert.match(run({ history: 20 }).say, /step 14/, 'the narration says the rule fell out of view');
  // The narration's covered warnings are real warnings, so hiding them never hides news.
  for (const r of configs) for (const k of r.covered) assert.ok(r.warnings.some((w) => w.key === k), 'covered ' + k);
  // Every block belongs to a legend group, so the bar can be read in words.
  for (const r of configs) for (const b of r.blocks) assert.ok(['rules', 'extras', 'history', 'files', 'user'].includes(b.group), b.key);

  // Without tool definitions the model cannot call any tool, so nothing is "one tool call away".
  const noTools = run({ tools: 'none' });
  assert.ok(!noTools.blocks.some((b) => b.key === 'tools'));
  assert.ok(noTools.probes.every((p) => p.state === 'in' || p.state === 'none'), 'no tools, no retrieval and no search');
  assert.equal(probe(noTools, 'suite').state, 'none');
  assert.equal(probe(noTools, 'callers').state, 'in', 'the helper report is still in view');
  assert.equal(probe(run({ tools: 'none', subagent: false }), 'callers').state, 'none');

  // "What just changed": plain sentences about the size change and every answer that changed.
  assert.match(s.describe(d, run({ subagent: false })), /helper agent/);
  assert.match(s.describe(d, run({ subagent: false })), /Now one tool call away: the callers of is_valid\(\)\./);
  assert.match(s.describe(d, run({ compacted: true, summary: 'careless' })), /careless[\s\S]*out of reach/);
  assert.match(s.describe(d, run({ tools: 'none' })), /tool list[\s\S]*out of reach/);
  assert.match(s.describe(d, run({ agents: false })), /findable only by searching: the changelog rule/);
  assert.match(s.describe(d, run({ memory: false })), /900 tokens/);
  assert.match(s.describe(d, run({ memory: false })), /Every answer stays the same/);
  assert.match(s.describe(d, allTools), /does not fit/i);

  // Purity: build does not change its input.
  const input = cfg({ compacted: true });
  const snapshot = JSON.stringify(input);
  s.build(input);
  assert.equal(JSON.stringify(input), snapshot);
}
