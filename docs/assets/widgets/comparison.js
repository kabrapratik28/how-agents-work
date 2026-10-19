/* Column toggles for the comparison table (chapter 17b). The table is plain HTML in the page and works
   without JavaScript. Mount: <div class="widget" data-widget="comparison" data-target="TABLE-ID">.
   Columns come from <th data-col="KEY" data-label="Name" data-default> in the table head; every cell in that
   column carries the same data-col. AC.sims['comparison'] holds the visibility logic, tested by
   tools/sims/comparison.test.mjs. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  function initial(cols, defaults) {
    var vis = {};
    cols.forEach(function (c) { vis[c] = defaults.indexOf(c) !== -1; });
    if (cols.length && !cols.some(function (c) { return vis[c]; })) vis[cols[0]] = true;
    return vis;
  }

  // Returns a new map. Refuses to hide the last visible column, so the table never goes empty.
  function toggle(vis, key) {
    var next = {};
    Object.keys(vis).forEach(function (k) { next[k] = vis[k]; });
    if (!Object.prototype.hasOwnProperty.call(next, key)) return next;
    var shown = Object.keys(next).filter(function (k) { return next[k]; }).length;
    if (next[key] && shown === 1) return next;
    next[key] = !next[key];
    return next;
  }

  AC.sims['comparison'] = { initial: initial, toggle: toggle };

  AC.widgets['comparison'] = function (root) {
    var table = document.getElementById(root.getAttribute('data-target') || '');
    if (!table) throw new Error('comparison: no table with id "' + root.getAttribute('data-target') + '"');
    var heads = Array.prototype.slice.call(table.querySelectorAll('thead th[data-col]'));
    var cols = heads.map(function (th) { return th.getAttribute('data-col'); });
    var defaults = heads.filter(function (th) { return th.hasAttribute('data-default'); })
      .map(function (th) { return th.getAttribute('data-col'); });
    var vis = initial(cols, defaults);
    var boxes = {};
    var labelId = AC.uid('cmp-label');
    var status = AC.h('p', { class: 'w-note cmp-status', 'aria-live': 'polite' });

    function apply(note) {
      cols.forEach(function (c) {
        table.querySelectorAll('[data-col="' + c + '"]').forEach(function (el) { el.hidden = !vis[c]; });
        boxes[c].checked = vis[c];
      });
      var n = cols.filter(function (c) { return vis[c]; }).length;
      status.textContent = note || ('Showing ' + n + ' of ' + cols.length + ' systems. Scroll the table sideways if it is wider than the screen.');
    }

    var group = AC.h('div', { class: 'cmp-toggles', role: 'group', 'aria-labelledby': labelId },
      AC.h('span', { class: 'cmp-label', id: labelId, text: 'Show columns:' }));
    heads.forEach(function (th) {
      var c = th.getAttribute('data-col');
      var box = AC.h('input', {
        type: 'checkbox',
        on: { change: function () {
          var before = vis[c];
          vis = toggle(vis, c);
          apply(before === vis[c] ? 'At least one system column stays visible.' : '');
        } }
      });
      boxes[c] = box;
      group.appendChild(AC.h('label', { class: 'w-toggle' }, box, th.getAttribute('data-label') || th.textContent.trim()));
    });
    root.appendChild(group);
    root.appendChild(status);
    apply();
  };
})();
