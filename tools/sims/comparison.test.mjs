// Lesson invariants for the comparison table column toggles (chapter 17b).
export default function (sims, assert) {
  const s = sims['comparison'];
  const cols = ['pi', 'deepagents', 'hermes', 'openhands', 'langgraph'];
  const shown = (v) => Object.keys(v).filter((k) => v[k]);

  // Pi, Deep Agents, and Hermes start on; the others start off.
  const v = s.initial(cols, ['pi', 'deepagents', 'hermes']);
  assert.deepEqual(v, { pi: true, deepagents: true, hermes: true, openhands: false, langgraph: false });

  // An optional column turns on and off again, without mutating the old state.
  const on = s.toggle(v, 'openhands');
  assert.equal(on.openhands, true);
  assert.equal(v.openhands, false, 'toggle returns a new map');
  assert.equal(s.toggle(on, 'openhands').openhands, false);

  // The last visible column cannot be hidden: the table never goes empty.
  const one = s.toggle(s.toggle(v, 'pi'), 'deepagents');
  assert.deepEqual(shown(one), ['hermes']);
  assert.deepEqual(shown(s.toggle(one, 'hermes')), ['hermes']);

  // Unknown keys change nothing, and a table with no defaults still shows one column.
  assert.deepEqual(s.toggle(v, 'nope'), v);
  assert.deepEqual(shown(s.initial(['a', 'b'], [])), ['a']);
}
