/* How AI Agents Work: site behavior. Loads after chapters.js and before widget files; initializes on DOMContentLoaded. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  /* ---------- helpers ---------- */

  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }

  // AC.h('div', {class: 'x', text: 'hi', on: {click: fn}, 'aria-label': '...'}, child, ...)
  AC.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { el.addEventListener(ev, v[ev]); });
        else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { el.style[p] = v[p]; });
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, String(v));
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  };

  var uidN = 0;
  AC.uid = function (prefix) { uidN += 1; return (prefix || 'ac') + '-' + uidN; };
  AC.fmt = function (n) { return Math.round(n).toLocaleString('en-US'); };
  AC.reducedMotion = function () {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  };

  // Namespaced, versioned storage with an in-memory fallback (file:// and private modes can block localStorage).
  AC.store = (function () {
    var NS = 'haw:v1:';
    var mem = {};
    var failed = {}; // keys whose last write to localStorage failed: read them from memory
    var ls = null;
    try {
      ls = window.localStorage;
      ls.setItem(NS + '__probe', '1');
      ls.removeItem(NS + '__probe');
    } catch (e) { ls = null; }
    return {
      available: !!ls,
      get: function (key, fallback) {
        if (ls && !failed[key]) {
          try {
            var raw = ls.getItem(NS + key);
            if (raw != null) return JSON.parse(raw);
          } catch (e) { /* fall through to memory */ }
        }
        return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : fallback;
      },
      set: function (key, value) {
        mem[key] = value;
        if (!ls) return false;
        try { ls.setItem(NS + key, JSON.stringify(value)); delete failed[key]; return true; }
        catch (e) { failed[key] = true; return false; }
      }
    };
  })();

  /* ---------- course data ---------- */

  function currentFile() {
    var last = location.pathname.split('/').pop();
    return last && /\.html?$/.test(last) ? last : 'index.html';
  }
  function chapters() { return AC.chapters || []; }
  function isCourseChapter(c) { return c.part !== 'ref'; }
  function isDone(file) { return !!AC.store.get('done:' + file, false); }
  function progress() {
    var list = chapters().filter(isCourseChapter);
    var done = list.filter(function (c) { return isDone(c.file); }).length;
    return { done: done, total: list.length };
  }

  /* ---------- the loop map ---------- */

  AC.LOOP = [
    { key: 'state', label: 'State', role: 'state', pos: [1, 1] },
    { key: 'context', label: 'Build context', role: 'runtime', pos: [1, 3] },
    { key: 'model', label: 'Call model', role: 'model', pos: [1, 5] },
    { key: 'decide', label: 'Model decides', role: 'model', pos: [3, 5] },
    { key: 'act', label: 'Runtime acts', role: 'runtime', pos: [3, 3] },
    { key: 'update', label: 'Update state', role: 'runtime', pos: [3, 1] }
  ];
  var ARROWS = [[1, 2, '→'], [1, 4, '→'], [2, 5, '↓'], [3, 4, '←'], [3, 2, '←'], [2, 1, '↑']];

  // Returns the grid element. opts.big for the large widget version.
  AC.renderLoop = function (container, focus, opts) {
    opts = opts || {};
    focus = focus || [];
    var all = focus.indexOf('all') !== -1;
    var grid = AC.h('div', { class: 'lm-grid' + (opts.big ? ' big' : '') + (focus.length && !all ? ' has-focus' : '') });
    AC.LOOP.forEach(function (n) {
      grid.appendChild(AC.h('div', {
        class: 'lm-node ' + n.role + (focus.indexOf(n.key) !== -1 ? ' is-focus' : ''),
        'data-key': n.key,
        text: n.label,
        style: { gridRow: String(n.pos[0]), gridColumn: String(n.pos[1]) }
      }));
    });
    ARROWS.forEach(function (a) {
      grid.appendChild(AC.h('div', { class: 'lm-arrow', 'aria-hidden': 'true', text: a[2], style: { gridRow: String(a[0]), gridColumn: String(a[1]) } }));
    });
    container.appendChild(grid);
    return grid;
  };

  function renderLoopMap(el) {
    var focus = (el.getAttribute('data-focus') || '').split(/\s+/).filter(Boolean);
    var all = focus.indexOf('all') !== -1;
    var labels = AC.LOOP.filter(function (n) { return focus.indexOf(n.key) !== -1; }).map(function (n) { return n.label; });
    var summary = 'The agent loop: State, Build context, Call model, Model decides, Runtime acts, Update state, then repeat.';
    var caption = el.getAttribute('data-caption') || (all ? 'This chapter is about the whole loop.' : (labels.length ? 'This chapter extends: ' + labels.join(', ') + '.' : ''));
    el.textContent = '';
    var grid = AC.renderLoop(el, focus);
    grid.setAttribute('role', 'img');
    grid.setAttribute('aria-label', summary + (caption ? ' ' + caption : ''));
    if (caption) el.appendChild(AC.h('p', { class: 'lm-caption', 'aria-hidden': 'true', text: caption + ' Violet steps are the model. Blue steps are your code.' }));
    if (el.hasAttribute('data-animate') && !AC.reducedMotion()) {
      var nodes = grid.querySelectorAll('.lm-node');
      var n = 0;
      // One trip around the loop, under five seconds, then it rests with every step shown.
      grid.classList.add('cycling');
      var tick = function () {
        if (n === nodes.length) {
          clearInterval(timer);
          grid.classList.remove('cycling');
          nodes.forEach(function (x) { x.classList.remove('is-active'); });
          return;
        }
        nodes.forEach(function (x, k) { x.classList.toggle('is-active', k === n); });
        n += 1;
      };
      var timer = setInterval(tick, 700);
      tick();
    }
  }

  /* ---------- theme ---------- */

  function effectiveTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function themeButton() {
    var b = AC.h('button', { class: 'tb-btn', type: 'button' });
    function paint() {
      var dark = effectiveTheme() === 'dark';
      b.textContent = dark ? 'Light' : 'Dark';
      b.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme');
    }
    b.addEventListener('click', function () {
      var next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      AC.store.set('theme', next);
      paint();
    });
    paint();
    return b;
  }

  /* ---------- navigation ---------- */

  var progressEls = [];
  function paintProgress() {
    var p = progress();
    progressEls.forEach(function (fn) { fn(p); });
  }

  function buildSidebar(file) {
    var nav = AC.h('nav', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Course chapters' });
    nav.appendChild(AC.h('a', { class: 'sb-brand', href: 'index.html', text: 'How AI Agents Work' }));
    nav.appendChild(AC.h('p', { class: 'sb-tag', text: 'Concepts and architecture, frameworks as case studies' }));
    var prText = AC.h('p', { class: 'sb-progress' });
    var barFill = AC.h('span');
    nav.appendChild(prText);
    nav.appendChild(AC.h('div', { class: 'sb-bar', 'aria-hidden': 'true' }, barFill));
    progressEls.push(function (p) {
      prText.textContent = p.done + ' of ' + p.total + ' chapters done';
      barFill.style.width = (p.total ? 100 * p.done / p.total : 0) + '%';
    });
    var checks = [];
    (AC.parts || []).forEach(function (part) {
      var items = chapters().filter(function (c) { return c.part === part.id; });
      if (!items.length) return;
      var hid = AC.uid('sb-part');
      nav.appendChild(AC.h('p', { class: 'sb-part', id: hid, text: part.title }));
      var ul = AC.h('ul', { class: 'sb-list', 'aria-labelledby': hid });
      items.forEach(function (c) {
        var a = AC.h('a', { href: c.file }, AC.h('span', { class: 'sb-num', text: c.num }), AC.h('span', { text: c.title }));
        if (c.file === file) a.setAttribute('aria-current', 'page');
        var check = AC.h('span', { class: 'sb-check' });
        a.appendChild(check);
        checks.push({ file: c.file, el: check });
        ul.appendChild(AC.h('li', null, a));
      });
      nav.appendChild(ul);
    });
    progressEls.push(function () {
      checks.forEach(function (c) {
        c.el.textContent = '';
        if (isDone(c.file)) {
          c.el.appendChild(document.createTextNode('✓'));
          c.el.appendChild(AC.h('span', { class: 'visually-hidden', text: ' (done)' }));
        }
      });
    });
    return nav;
  }

  function enhanceTopbar(sidebar) {
    var tb = document.querySelector('.topbar');
    if (!tb) return;
    var menu = AC.h('button', { class: 'tb-btn menu-btn', type: 'button', 'aria-controls': 'sidebar', 'aria-expanded': 'false', text: 'Menu' });
    tb.insertBefore(menu, tb.firstChild);
    tb.appendChild(AC.h('span', { class: 'tb-spacer' }));
    var pr = AC.h('span', { class: 'tb-progress' });
    progressEls.push(function (p) { pr.textContent = p.done + '/' + p.total + ' done'; });
    tb.appendChild(pr);
    tb.appendChild(themeButton());
    var backdrop = AC.h('div', { class: 'nav-backdrop' });
    document.body.appendChild(backdrop);
    var close = AC.h('button', { class: 'tb-btn sb-close', type: 'button', text: 'Close menu' });
    sidebar.insertBefore(close, sidebar.firstChild);
    var mobile = window.matchMedia ? window.matchMedia('(max-width: 1099.98px)') : { matches: false };
    // On small screens the closed drawer is off screen: make it inert so Tab skips it.
    // While it is open, the page behind it is inert, so focus stays in the drawer.
    function paintInert() {
      var open = document.body.classList.contains('nav-open');
      sidebar.inert = mobile.matches && !open;
      document.querySelectorAll('main, .site-footer, .topbar, .toc').forEach(function (el) { el.inert = mobile.matches && open; });
    }
    function setOpen(open) {
      document.body.classList.toggle('nav-open', open);
      menu.setAttribute('aria-expanded', String(open));
      paintInert();
      if (open) {
        var target = sidebar.querySelector('[aria-current="page"]') || sidebar.querySelector('a');
        if (target) target.focus();
      } else {
        menu.focus();
      }
    }
    menu.addEventListener('click', function () { setOpen(!document.body.classList.contains('nav-open')); });
    close.addEventListener('click', function () { setOpen(false); });
    backdrop.addEventListener('click', function () { setOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) setOpen(false);
    });
    if (mobile.addEventListener) mobile.addEventListener('change', function () { if (!mobile.matches) document.body.classList.remove('nav-open'); paintInert(); });
    AC.paintNavInert = paintInert;
  }

  function buildPager(file) {
    var list = chapters();
    var i = -1;
    for (var k = 0; k < list.length; k++) if (list[k].file === file) i = k;
    if (i < 0) return;
    var main = document.querySelector('main');
    if (!main) return;
    if (isCourseChapter(list[i])) {
      var btn = AC.h('button', { class: 'w-btn', type: 'button' });
      var msg = AC.h('p', { 'aria-live': 'polite' });
      var paint = function () {
        var d = isDone(file);
        btn.textContent = d ? 'Completed (undo)' : 'Mark chapter complete';
        btn.setAttribute('aria-pressed', String(d));
        msg.textContent = d
          ? (AC.store.available ? 'Saved in this browser.' : 'Storage is blocked here, so this resets when you leave the page.')
          : 'Mark it when you can answer the questions above.';
      };
      btn.addEventListener('click', function () {
        AC.store.set('done:' + file, !isDone(file));
        paint();
        paintProgress();
      });
      paint();
      main.appendChild(AC.h('div', { class: 'complete-row' }, btn, msg));
    }
    var pager = AC.h('nav', { class: 'pager', 'aria-label': 'Previous and next chapter' });
    if (i > 0) pager.appendChild(AC.h('a', { class: 'prev', href: list[i - 1].file }, AC.h('small', { text: 'Previous' }), list[i - 1].num + ' · ' + list[i - 1].title));
    if (i < list.length - 1) pager.appendChild(AC.h('a', { class: 'next', href: list[i + 1].file }, AC.h('small', { text: 'Next' }), list[i + 1].num + ' · ' + list[i + 1].title));
    main.appendChild(pager);
  }

  function markHomeProgress() {
    var cards = document.querySelectorAll('a.map-card');
    if (!cards.length) return;
    progressEls.push(function () {
      cards.forEach(function (a) {
        var num = a.querySelector('.map-num');
        if (!num) return;
        var old = num.querySelector('.map-done');
        if (old) old.remove();
        if (isDone(a.getAttribute('href'))) num.appendChild(AC.h('span', { class: 'map-done', text: 'Done' }));
      });
    });
  }

  /* ---------- quizzes, exercises, ticks, glossary ---------- */

  function enhanceQuizzes() {
    document.querySelectorAll('.quiz').forEach(function (q) {
      var ol = q.querySelector('ol.options');
      if (!ol) return;
      q.classList.add('js');
      var qText = q.querySelector('.q');
      if (qText && !qText.id) qText.id = AC.uid('q');
      ol.setAttribute('role', 'group');
      if (qText) ol.setAttribute('aria-labelledby', qText.id);
      var live = AC.h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
      q.appendChild(live);
      var details = q.querySelector('details.answer');
      var sorter = q.classList.contains('sorter');
      if (sorter && details) details.hidden = true;
      if (sorter && ol.children.length > 3) q.classList.add('stacked');
      var opts = [];
      Array.prototype.slice.call(ol.children).forEach(function (li, idx) {
        var btn = AC.h('button', { type: 'button', class: 'opt-btn' });
        btn.appendChild(AC.h('span', { class: 'opt-letter', 'aria-hidden': 'true', text: String.fromCharCode(65 + idx) }));
        var body = AC.h('span', { class: 'opt-text' });
        while (li.firstChild) body.appendChild(li.firstChild);
        btn.appendChild(body);
        var mark = AC.h('span', { class: 'opt-mark' });
        btn.appendChild(mark);
        li.appendChild(btn);
        var correct = li.hasAttribute('data-correct');
        opts.push({ btn: btn, mark: mark, correct: correct });
        btn.addEventListener('click', function () {
          if (q.getAttribute('data-answered')) return;
          q.setAttribute('data-answered', correct ? 'right' : 'wrong');
          opts.forEach(function (o) {
            o.btn.setAttribute('aria-disabled', 'true');
            if (o.correct) { o.btn.classList.add('correct'); o.mark.textContent = o.btn === btn ? 'Correct' : 'Answer'; }
          });
          if (!correct) { btn.classList.add('wrong'); mark.textContent = sorter ? '✗' : 'Not quite'; }
          if (sorter) opts.forEach(function (o) { if (o.correct) o.mark.textContent = '✓'; });
          live.textContent = correct ? 'Correct.' : 'Not quite. The correct answer is now marked.';
          if (details) { details.hidden = false; details.open = true; }
          updateGroupScore(q);
        });
      });
    });
  }
  function updateGroupScore(q) {
    var g = q.closest('.quiz-group');
    if (!g) return;
    var out = g.querySelector('.quiz-score');
    if (!out) return;
    var qs = g.querySelectorAll('.quiz');
    var answered = 0, right = 0;
    qs.forEach(function (x) {
      var a = x.getAttribute('data-answered');
      if (a) answered++;
      if (a === 'right') right++;
    });
    out.textContent = right + ' of ' + answered + ' right so far' + (answered < qs.length ? ', ' + (qs.length - answered) + ' to go.' : '. Done.');
  }

  function enhanceExercises() {
    document.querySelectorAll('textarea.ex-notes').forEach(function (ta) {
      if (!ta.id) return;
      var key = 'ex:' + currentFile() + ':' + ta.id;
      var saved = AC.store.get(key, '');
      if (saved && !ta.value) ta.value = saved;
      var status = AC.h('span', { 'aria-live': 'polite' });
      var copy = AC.h('button', { type: 'button', class: 'w-btn', text: 'Copy' });
      ta.insertAdjacentElement('afterend', AC.h('div', { class: 'ex-tools' }, copy, status));
      status.textContent = AC.store.available
        ? (saved ? 'Saved in this browser.' : 'Saved in this browser as you type.')
        : 'Not saved: this browser blocks storage for this page. Use Copy to keep your notes.';
      var timer = null;
      ta.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          status.textContent = AC.store.set(key, ta.value) ? 'Saved in this browser.' : 'Not saved: storage is unavailable here. Use Copy.';
        }, 400);
      });
      copy.addEventListener('click', function () {
        var ok = function () { status.textContent = 'Copied to the clipboard.'; };
        var fallback = function () {
          ta.select();
          try { document.execCommand('copy'); ok(); } catch (e) { status.textContent = 'Copy failed. Select the text and copy it yourself.'; }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(ok, fallback);
        else fallback();
      });
    });
  }

  function enhanceTicks() {
    var boxes = document.querySelectorAll('input.can-answer');
    if (!boxes.length) return;
    var out = document.getElementById('can-answer-count');
    var count = function () {
      if (!out) return;
      var n = 0;
      boxes.forEach(function (b) { if (b.checked) n++; });
      out.textContent = n + ' of ' + boxes.length;
    };
    boxes.forEach(function (b) {
      if (!b.id) return;
      b.checked = !!AC.store.get('can:' + b.id, false);
      b.addEventListener('change', function () { AC.store.set('can:' + b.id, b.checked); count(); });
    });
    count();
  }

  function enhanceGlossary() {
    var input = document.getElementById('glossary-filter');
    if (!input) return;
    var terms = document.querySelectorAll('.term');
    var out = document.getElementById('glossary-count');
    input.hidden = false;
    var label = document.querySelector('label[for="glossary-filter"]');
    if (label) label.hidden = false;
    var run = function () {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      terms.forEach(function (t) {
        var hit = !q || t.textContent.toLowerCase().indexOf(q) !== -1;
        t.hidden = !hit;
        if (hit) shown++;
      });
      if (out) out.textContent = shown + ' of ' + terms.length + ' terms shown';
    };
    input.addEventListener('input', run);
    run();
  }

  /* ---------- on this page ---------- */

  function buildToc() {
    var main = document.querySelector('main.chapter');
    if (!main) return;
    var heads = main.querySelectorAll(':scope > section[id] > h2');
    if (heads.length < 4) return;
    var list = AC.h('ol');
    var links = [];
    heads.forEach(function (h2) {
      var id = h2.parentElement.id;
      var a = AC.h('a', { href: '#' + id, text: h2.textContent });
      links.push({ a: a, el: h2.parentElement });
      list.appendChild(AC.h('li', null, a));
    });
    document.body.appendChild(AC.h('nav', { class: 'toc', 'aria-label': 'On this page' }, AC.h('p', { class: 'toc-title', text: 'On this page' }), list));
    document.body.classList.add('has-toc');
    if (!('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        links.forEach(function (l) { l.a.classList.toggle('is-current', l.el === e.target); });
      });
    }, { rootMargin: '-15% 0px -70% 0px' });
    links.forEach(function (l) { io.observe(l.el); });
  }

  /* ---------- polish: code colors, heading links, reading time, progress ---------- */

  var KW = 'def|return|if|elif|else|for|while|in|not|and|or|None|True|False|import|from|class|try|except|raise|with|function|var|const|let|async|await|new';
  var TOKEN = new RegExp('("(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\')|((?:^|\\s)(?:#|\\/\\/)[^\\n]*)|\\b(' + KW + ')\\b', 'g');
  function esc(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function colorLine(line) {
    if (/^\+(\s|$)/.test(line)) return '<span class="hl-add">' + esc(line) + '</span>';
    if (/^-(\s|$)/.test(line)) return '<span class="hl-del">' + esc(line) + '</span>';
    var out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(line))) {
      out += esc(line.slice(last, m.index));
      var cls = m[1] ? 'hl-str' : (m[2] ? 'hl-com' : 'hl-kw');
      out += '<span class="' + cls + '">' + esc(m[0]) + '</span>';
      last = TOKEN.lastIndex;
      if (m[0] === '') TOKEN.lastIndex++;
    }
    return out + esc(line.slice(last));
  }
  function highlightCode() {
    document.querySelectorAll('pre:not(.diagram) > code').forEach(function (code) {
      if (code.children.length) return; // already marked up by the author
      code.innerHTML = code.textContent.split('\n').map(colorLine).join('\n');
    });
  }

  function headingLinks() {
    document.querySelectorAll('main section[id] > h2').forEach(function (h2) {
      h2.appendChild(AC.h('a', { class: 'h-anchor', href: '#' + h2.parentElement.id, 'aria-label': 'Link to this section', text: '#' }));
    });
  }

  function readingTime() {
    var main = document.querySelector('main.chapter');
    var kicker = main && main.querySelector('.kicker');
    if (!kicker) return;
    var words = (main.textContent.match(/\S+/g) || []).length;
    kicker.appendChild(AC.h('span', { class: 'read-time', text: ' · ' + Math.max(1, Math.round(words / 230)) + ' min read' }));
  }

  function readingProgress() {
    if (!document.querySelector('main.chapter')) return;
    var fill = AC.h('span');
    document.body.appendChild(AC.h('div', { class: 'read-progress', 'aria-hidden': 'true' }, fill));
    var queued = false;
    var paint = function () {
      queued = false;
      var max = document.documentElement.scrollHeight - window.innerHeight;
      fill.style.width = (max > 0 ? Math.min(100, 100 * window.scrollY / max) : 0) + '%';
    };
    window.addEventListener('scroll', function () { if (!queued) { queued = true; requestAnimationFrame(paint); } }, { passive: true });
    paint();
  }

  function footer() {
    document.body.appendChild(AC.h('footer', { class: 'site-footer' },
      AC.h('span', { text: 'How AI Agents Work. Concepts first, frameworks as case studies.' }),
      AC.h('span', { text: 'Your progress and notes stay in this browser.' })));
  }

  /* ---------- widgets ---------- */

  function mountWidgets() {
    document.querySelectorAll('[data-widget]').forEach(function (el) {
      var name = el.getAttribute('data-widget');
      try {
        var fn = AC.widgets[name];
        if (typeof fn !== 'function') throw new Error('widget "' + name + '" is not registered');
        el.textContent = '';
        fn(el);
        el.setAttribute('data-widget-status', 'ok');
      } catch (err) {
        el.setAttribute('data-widget-status', 'error');
        el.textContent = '';
        el.appendChild(AC.h('p', { class: 'w-warn', text: 'This interactive widget failed to load. The text around it covers the same idea.' }));
        if (window.console) console.error('[widget ' + name + ']', err);
      }
    });
  }

  /* ---------- init ---------- */

  function addFavicon() {
    if (document.querySelector('link[rel~="icon"]')) return;
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%236d28d9'/>" +
      "<path d='M22 16a6 6 0 1 1-6-6h3' fill='none' stroke='white' stroke-width='3' stroke-linecap='round'/>" +
      "<path d='M17 6.5l3 3.5-3 3.5' fill='none' stroke='white' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/></svg>";
    document.head.appendChild(AC.h('link', { rel: 'icon', href: 'data:image/svg+xml,' + svg }));
  }

  function init() {
    var file = currentFile();
    addFavicon();
    document.body.insertBefore(AC.h('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }), document.body.firstChild);
    var sidebar = buildSidebar(file);
    var tb = document.querySelector('.topbar');
    if (tb) tb.insertAdjacentElement('afterend', sidebar); else document.body.insertBefore(sidebar, document.body.firstChild);
    document.body.classList.add('has-sidebar');
    enhanceTopbar(sidebar);
    document.querySelectorAll('.loop-map').forEach(renderLoopMap);
    enhanceQuizzes();
    enhanceExercises();
    enhanceTicks();
    enhanceGlossary();
    markHomeProgress();
    buildPager(file);
    buildToc();
    highlightCode();
    headingLinks();
    readingTime();
    readingProgress();
    footer();
    if (AC.paintNavInert) AC.paintNavInert();
    paintProgress();
    mountWidgets();
  }

  // Deferred scripts run before DOMContentLoaded, so every widget file has registered by the time init runs.
  if (document.readyState === 'complete') init();
  else document.addEventListener('DOMContentLoaded', init);
})();
