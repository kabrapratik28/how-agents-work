/* Shared step controller for step-through widgets.
   var s = AC.stepper({
     count: function () { return steps.length; },      // may change after a branch choice
     render: function (i, narrationEl) { ... },        // draw step i and fill the narration
     blocked: function (i) { return false; },          // true: Next waits (for example, for a choice)
     onReset: function () { ... },                      // optional
     playDelay: 1800                                    // optional, ms
   });
   container.appendChild(s.el);   // s.go(i), s.next(), s.prev(), s.reset(), s.refresh(), s.index()
*/
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};

  AC.stepper = function (opts) {
    var h = AC.h;
    var i = 0;
    var timer = null;
    var blocked = opts.blocked || function () { return false; };

    var narration = h('div', { class: 'w-narration', 'aria-live': 'polite' });
    var back = h('button', { class: 'w-btn', type: 'button', text: '← Back' });
    var next = h('button', { class: 'w-btn primary', type: 'button', text: 'Next →' });
    var reset = h('button', { class: 'w-btn', type: 'button', text: 'Reset' });
    var play = h('button', { class: 'w-btn', type: 'button', text: 'Play', 'aria-pressed': 'false' });
    var counter = h('span', { class: 'w-counter', 'aria-hidden': 'true' });
    var fill = h('span');
    var controls = h('div', { class: 'w-controls' }, back, next, reset, play, counter);
    var el = h('div', { class: 'w-stepper' }, narration, controls, h('div', { class: 'w-progress', 'aria-hidden': 'true' }, fill));
    if (AC.reducedMotion()) play.hidden = true;

    function count() { return Math.max(1, opts.count()); }

    function paintControls() {
      var n = count();
      back.disabled = i === 0;
      next.disabled = i >= n - 1 || blocked(i);
      counter.textContent = blocked(i) && i >= n - 1 ? 'Step ' + (i + 1) + ', waiting for your choice' : 'Step ' + (i + 1) + ' of ' + n;
      fill.style.width = (100 * (i + 1) / n) + '%';
    }

    function go(target) {
      var hadFocus = document.activeElement;
      i = Math.max(0, Math.min(count() - 1, target));
      narration.textContent = '';
      narration.appendChild(h('span', { class: 'visually-hidden', text: 'Step ' + (i + 1) + ' of ' + count() + '. ' }));
      opts.render(i, narration);
      paintControls();
      var choice = narration.querySelector('button');
      if (hadFocus === next && next.disabled) (choice || reset).focus();
      else if (hadFocus === back && back.disabled) next.focus();
      else if (hadFocus && hadFocus !== document.body && !document.contains(hadFocus)) {
        // the focused control (for example a choice button) was re-rendered away
        (!next.disabled ? next : (choice || reset)).focus();
      }
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      play.textContent = 'Play';
      play.setAttribute('aria-pressed', 'false');
    }

    back.addEventListener('click', function () { stop(); go(i - 1); });
    next.addEventListener('click', function () { stop(); go(i + 1); });
    reset.addEventListener('click', function () {
      stop();
      if (opts.onReset) opts.onReset();
      go(0);
    });
    play.addEventListener('click', function () {
      if (timer) { stop(); return; }
      play.textContent = 'Pause';
      play.setAttribute('aria-pressed', 'true');
      timer = setInterval(function () {
        if (i >= count() - 1 || blocked(i)) { stop(); return; }
        go(i + 1);
      }, opts.playDelay || 1800);
    });
    controls.addEventListener('keydown', function (e) {
      if (e.target.tagName !== 'BUTTON') return;
      if (e.key === 'ArrowRight' && !next.disabled) { e.preventDefault(); stop(); go(i + 1); }
      if (e.key === 'ArrowLeft' && !back.disabled) { e.preventDefault(); stop(); go(i - 1); }
    });

    return {
      el: el,
      narration: narration,
      go: go,
      next: function () { go(i + 1); },
      prev: function () { go(i - 1); },
      reset: function () { stop(); if (opts.onReset) opts.onReset(); go(0); },
      refresh: function () { go(i); },
      stop: stop,
      index: function () { return i; }
    };
  };
})();
