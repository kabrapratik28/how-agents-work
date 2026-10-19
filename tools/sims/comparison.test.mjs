// Lesson invariants for the comparison table column toggles (chapter 17b), checked against the real page.
import fs from 'node:fs';

export default function (sims, assert) {
  const s = sims['comparison'];
  const html = fs.readFileSync(new URL('../../docs/17b-comparison.html', import.meta.url), 'utf8');
  const table = html.slice(html.indexOf('id="cmp-table"'), html.indexOf('</table>', html.indexOf('id="cmp-table"')));
  const heads = [...table.matchAll(/<th scope="col" data-col="([a-z]+)"([^>]*)>/g)];
  const cols = heads.map((m) => m[1]);
  const defaults = heads.filter((m) => /\bdata-default\b/.test(m[2])).map((m) => m[1]);
  const shown = (v) => Object.keys(v).filter((k) => v[k]);

  // The page has three columns, all on by default, and every row has one cell per column.
  assert.deepEqual(cols, ['pi', 'deepagents', 'hermes']);
  assert.deepEqual(defaults, cols);
  const rows = (table.match(/<th scope="row">/g) || []).length;
  assert.equal(rows, 13, 'the 13 required rows');
  for (const c of cols) assert.equal((table.match(new RegExp(`<td data-col="${c}"`, 'g')) || []).length, rows, `${c} has a cell in every row`);

  // Toggling hides and restores a column, without mutating the old state.
  const v = s.initial(cols, defaults);
  assert.deepEqual(shown(v), cols);
  const noPi = s.toggle(v, 'pi');
  assert.deepEqual(shown(noPi), ['deepagents', 'hermes']);
  assert.deepEqual(shown(v), cols, 'toggle returns a new map');
  assert.deepEqual(shown(s.toggle(noPi, 'pi')), cols);

  // The last visible column cannot be hidden, whichever it is, so the table never goes empty.
  for (const last of cols) {
    let w = v;
    for (const c of cols) if (c !== last) w = s.toggle(w, c);
    assert.deepEqual(shown(w), [last]);
    assert.deepEqual(shown(s.toggle(w, last)), [last], `${last} stays when it is the only column`);
  }

  // Unknown keys change nothing, and a table with no defaults still shows its first column.
  assert.deepEqual(s.toggle(v, 'nope'), v);
  assert.deepEqual(shown(s.initial(cols, [])), ['pi']);
}
