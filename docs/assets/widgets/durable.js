/* Crash-and-restart simulator (chapter 12).
   AC.sims['durable'].build(opts) expands one setup into steps. It is pure and tested by
   tools/sims/durable.test.mjs. Times, row counts, and the 24-hour window are made up. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  var OPTIONS = {
    mode: { label: 'What the worker saves', choices: [['none', 'Nothing'], ['checkpoint', 'A checkpoint after each step'], ['idempotent', 'Checkpoints, plus a key saved before sending']] },
    receiver: { label: 'The email service', choices: [['dedup', 'Ignores repeated keys for 24 hours'], ['plain', 'Sends every request']] },
    crash: { label: 'The worker crashes', choices: [['none', 'Never'], ['fetch_c', 'While fetching C'], ['after_send', 'Right after sending']] },
    delay: { label: 'A new worker starts', choices: [['now', '3 minutes later'], ['30h', '30 hours later']] }
  };
  var DEFAULTS = { mode: 'none', receiver: 'dedup', crash: 'after_send', delay: 'now' };
  var RETENTION = 24 * 60;          // minutes the email service remembers a key
  var OP_ID = 'op-8c41';            // the key saved before the first attempt
  var FRESH_KEYS = ['k-51d0', 'k-9e27'];   // keys made up at send time
  var WORKFLOW = ['fetch_a', 'fetch_b', 'fetch_c', 'summarize', 'write_report', 'send_email'];
  var LABEL = { fetch_a: 'Fetch A', fetch_b: 'Fetch B', fetch_c: 'Fetch C', summarize: 'Summarize', write_report: 'Write report', send_email: 'Send email' };
  var MEMORY_LABEL = { fetch_a: 'Fetch A', fetch_b: 'Fetch B', fetch_c: 'Fetch C', summarize: 'Summary', write_report: 'Report', send_email: 'Email', key: 'Email key' };
  var FETCH = {
    fetch_a: { result: '40 signup rows', ref: 'artifacts/a.json' },
    fetch_b: { result: '2 incident rows', ref: 'artifacts/b.json' },
    fetch_c: { result: '9 deploy rows', ref: 'artifacts/c.json' }
  };
  var SUMMARIES = ['Signups up 4%. Two incidents, both resolved.', 'Quiet week: two incidents closed, signups grew 4%.'];
  var REPORT = 'reports/2026-10-19.md';
  var SUBJECT = 'Weekly report, Oct 19';
  var START = {
    none: 'A nightly job starts. This worker keeps everything in memory and saves nothing to disk.',
    checkpoint: 'A nightly job starts. This worker saves a checkpoint to disk after every step.',
    idempotent: 'A nightly job starts. This worker saves a checkpoint after every step, and it saves a key for the email before sending it.'
  };
  var CHOICES = [
    { key: 'retry', label: 'Send again with the same key' },
    { key: 'query', label: 'Ask the email service' },
    { key: 'human', label: 'Ask a person' }
  ];

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function ago(min) { return min >= 120 ? Math.round(min / 60) + ' hours' : min + ' minutes'; }

  function build(opts) {
    opts = opts || {};
    var o = {};
    Object.keys(DEFAULTS).forEach(function (k) { o[k] = opts[k] || DEFAULTS[k]; });
    var ckpt = o.mode !== 'none';
    var steps = [];
    var memory = {};
    var store = ckpt ? { run: 'weekly-report-2026-10-19', done: {} } : null;
    var gwKeys = {};                 // what an email service that ignores repeats remembers: key -> {msg, at}
    var gwSent = [];                 // the service's history of sent emails: {msg, ref, at}
    var gwLog = [];
    var inbox = [];
    var c = { fetch: { a: 0, b: 0, c: 0 }, fetchTotal: 0, model: 0 };
    var sendState = null;
    var clock = 0;                   // minutes since the job started
    var restarted = false;
    var keyN = 0;

    function push(kind, actor, title, say, logText, extra) {
      var st = {
        kind: kind, actor: actor, title: title, say: say, at: null,
        log: { actor: actor, text: logText },
        memory: clone(memory), store: clone(store), gatewayLog: clone(gwLog), inbox: clone(inbox),
        counters: clone(c), sendState: sendState, restarted: restarted
      };
      if (extra) Object.keys(extra).forEach(function (k) { st[k] = extra[k]; });
      steps.push(st);
      clock += 1;
    }

    function setSend(state, extra) {
      sendState = state;
      store.send = store.send || { op_id: OP_ID };
      store.send.state = state;
      if (extra) Object.keys(extra).forEach(function (k) { store.send[k] = extra[k]; });
    }

    function gatewaySend(key) {
      var seen = gwKeys[key];
      if (o.receiver === 'dedup' && seen && clock - seen.at <= RETENTION) {
        gwLog.push({ type: 'send', key: key, delivered: false, msg: seen.msg, text: 'Key ' + key + ': seen before. Sent nothing, replied ' + seen.msg + '.' });
        return { msg: seen.msg, say: 'The email service saw key ' + key + ' ' + ago(clock - seen.at) + ' ago, so it sends nothing. It replies with the first email\'s id, ' + seen.msg + '.' };
      }
      var msg = 'm-' + (inbox.length + 1);
      var second = inbox.length > 0;
      inbox.push({ id: msg, subject: SUBJECT, body: memory.summarize, duplicate: second });
      gwSent.push({ msg: msg, ref: key, at: clock });
      var note, say;
      if (o.receiver === 'plain') {
        note = 'repeats not checked';
        say = second ? 'The email service does not check for repeats, so it sends a second email, ' + msg + '.'
          : 'The email service sends the email, ' + msg + '. It does not check for repeats.';
      } else if (seen) {
        note = 'not found, because keys expire after 24 hours';
        say = 'The email service forgets keys after 24 hours, so key ' + key + ' looks new. It sends a second email, ' + msg + '.';
      } else {
        note = 'new key';
        say = second ? 'The email service has never seen key ' + key + ', so it sends a second email, ' + msg + '.'
          : 'The email service has not seen key ' + key + ' before. It sends the email, ' + msg + ', and remembers the key for 24 hours.';
      }
      if (o.receiver === 'dedup') gwKeys[key] = { msg: msg, at: clock };
      gwLog.push({ type: 'send', key: key, delivered: true, msg: msg, text: 'Key ' + key + ': ' + note + '. Sent ' + msg + '.' });
      return { msg: msg, say: say };
    }

    function record(msg, byPerson) {
      memory.send_email = 'sent ' + msg;
      var at = { at: 'send_email' };
      if (o.mode === 'idempotent') {
        setSend('confirmed', byPerson ? { confirmed_by: 'person' } : { message_id: msg });
        push('confirm', 'store', 'Save the outcome', byPerson
          ? 'The worker saves the outcome: confirmed by a person. One email went out, but it cost someone\'s time.'
          : 'The worker saves the outcome: key ' + OP_ID + ' confirmed, email ' + msg + '.', 'saved: email confirmed', at);
      } else if (o.mode === 'checkpoint') {
        store.done.send_email = msg;
        push('record', 'store', 'Save the outcome', 'The service replies with ' + msg + '. The worker saves a checkpoint: email sent.', 'saved: email sent (' + msg + ')', at);
      } else {
        push('record', 'runtime', 'Reply received', 'The service replies with ' + msg + ', and the job is finished.', 'got the reply: ' + msg, at);
      }
    }

    function fetch(key) {
      var src = key.slice(-1);
      var name = src.toUpperCase();
      var again = c.fetch[src] > 0;
      c.fetch[src] += 1;
      c.fetchTotal += 1;
      if (o.crash === 'fetch_c' && key === 'fetch_c' && !restarted) {
        memory = {};
        push('crash', 'crash', 'Crash while fetching C', 'The worker starts fetching C and crashes before the answer comes back. Everything in its memory is gone.', 'crashed while fetching C', { at: key });
        return false;
      }
      memory[key] = FETCH[key].result;
      if (ckpt) store.done[key] = FETCH[key].ref;
      var say = !again ? 'The worker fetches ' + name + ' and gets ' + FETCH[key].result + '.'
        : ckpt ? 'The worker fetches ' + name + ' again, because the first try never finished.'
          : 'The worker fetches ' + name + ' again, because the first result was lost with the old worker.';
      say += ckpt ? ' It saves the result to disk.' : ' It keeps the result only in memory.';
      push('fetch', 'tool', LABEL[key] + (again ? ' again' : ''), say, 'fetched ' + name + (again ? ' again' : '') + ': ' + FETCH[key].result, { at: key });
      return true;
    }

    function summarize() {
      c.model += 1;
      var text = SUMMARIES[Math.min(c.model, SUMMARIES.length) - 1];
      memory.summarize = text;
      if (ckpt) store.done.summarize = text;
      var say = c.model === 1 ? 'The worker asks the model for a summary. The model writes: "' + text + '"'
        : 'The worker asks the model again. A model can answer differently each time, and now it writes: "' + text + '"';
      if (ckpt) say += ' The worker saves the reply to disk.';
      push('model', 'model', c.model === 1 ? 'Summarize (model call)' : 'Summarize again (model call)', say,
        c.model === 1 ? 'model wrote the summary' : 'model wrote the summary again, in different words', { at: 'summarize' });
    }

    function writeReport() {
      memory.write_report = REPORT;
      if (ckpt) store.done.write_report = REPORT;
      push('code', 'runtime', 'Write the report', 'Ordinary code turns the summary into a report file.' + (ckpt ? ' The worker saves a checkpoint.' : ''), 'wrote the report', { at: 'write_report' });
    }

    function send() {
      var at = { at: 'send_email' };
      var key;
      if (o.mode === 'idempotent') {
        key = OP_ID;
        setSend('intended');
        push('intent', 'store', 'Save the email key first', 'Before sending, the worker saves a record to disk: key ' + OP_ID + ', state intended. Nothing has been sent yet.', 'saved: key ' + OP_ID + ', intended', at);
        setSend('attempted');
        push('attempt', 'runtime', 'Mark it attempted, then send', 'The worker changes the record to attempted. Only then does it send the email, with key ' + OP_ID + '.', 'saved: attempted, then sent with key ' + OP_ID, at);
      } else {
        key = FRESH_KEYS[keyN];
        keyN += 1;
        memory.key = key;
        push('request', 'runtime', 'Send the email', 'The worker sends the email with key ' + key + ', which it makes up on the spot. The key exists only in memory.', 'sent with key ' + key, at);
      }
      var r = gatewaySend(key);
      push('gateway', 'gateway', 'The email service sends it', r.say, 'service sent ' + r.msg, at);
      if (o.crash === 'after_send' && !restarted) {
        memory = {};
        push('crash', 'crash', 'Crash before the reply is saved', 'The worker crashes before it saves the service\'s reply. The email is already in the team\'s inbox.' +
          (o.mode === 'idempotent' ? ' On disk, the record still says attempted.' : ''), 'crashed before saving the reply', at);
        return false;
      }
      record(r.msg);
      return true;
    }

    function step(key) {
      if (key === 'summarize') { summarize(); return true; }
      if (key === 'write_report') { writeReport(); return true; }
      if (key === 'send_email') return send();
      return fetch(key);
    }

    function runFrom(i) {
      for (var k = i; k < WORKFLOW.length; k++) if (!step(WORKFLOW[k])) return false;
      return true;
    }

    function restart() {
      restarted = true;
      clock += o.delay === '30h' ? 30 * 60 : 3;
      var when = o.delay === '30h' ? '30 hours' : '3 minutes';
      if (!ckpt) {
        push('restart', 'runtime', 'Start over', 'A new worker starts ' + when + ' later. Nothing was saved, so it runs the whole job again.', 'new worker: starting over');
        return 0;
      }
      memory = clone(store.done);
      var next = 0;
      while (next < WORKFLOW.length && store.done[WORKFLOW[next]]) next++;
      var say = 'A new worker starts ' + when + ' later and loads the checkpoint. ';
      if (store.send) say += 'The email record says attempted, and no reply was saved.';
      else if (next === WORKFLOW.length - 1) say += 'The report is written, but nothing says the email went out, so it looks unsent.';
      else say += WORKFLOW.slice(0, next).map(function (k) { return LABEL[k]; }).join(' and ') + ' are done, so it continues with ' + LABEL[WORKFLOW[next]] + '.';
      push('restart', 'runtime', 'Continue from the checkpoint', say, 'new worker: continues at ' + LABEL[WORKFLOW[next]].toLowerCase());
      return next;
    }

    // Returns false while the choice is still open.
    function recover() {
      var at = { at: 'send_email' };
      setSend('outcome unknown');
      var chosen = CHOICES.filter(function (x) { return x.key === opts.onUnknown; })[0] || null;
      var say = 'Was the email sent? The record cannot tell, so the worker marks it outcome unknown. What should it do?';
      push('choice', 'runtime', 'Outcome unknown', chosen ? say + ' You chose: ' + chosen.label + '.' : say,
        chosen ? 'chose: ' + chosen.label.toLowerCase() : 'marked the email outcome unknown', { at: 'send_email', choice: CHOICES, chosen: chosen ? chosen.key : null });
      if (!chosen) return false;
      if (chosen.key === 'retry') {
        push('retry', 'runtime', 'Send again with the same key', 'The worker sends the email again with the saved key, ' + OP_ID + '.', 'sent again with key ' + OP_ID, at);
        var r = gatewaySend(OP_ID);
        var sent = gwLog[gwLog.length - 1].delivered;
        push('gateway', 'gateway', sent ? 'The email service sends it again' : 'The email service ignores the repeat', r.say, sent ? 'service sent ' + r.msg : 'service ignored the repeat', at);
        record(r.msg);
      } else if (chosen.key === 'query') {
        var hit = gwSent.filter(function (e) { return e.ref === OP_ID; })[0];
        gwLog.push({ type: 'lookup', key: OP_ID, found: hit.msg, text: 'Search for key ' + OP_ID + ': found ' + hit.msg + '.' });
        push('lookup', 'gateway', 'Ask the email service', 'The worker asks the email service whether it sent an email with key ' + OP_ID + '. The service keeps 30 days of history, and it finds ' + hit.msg + '.', 'service found ' + hit.msg, at);
        record(hit.msg);
      } else {
        push('human', 'human', 'Ask a person', 'The worker pauses and asks a person. They check the team\'s inbox and find the report.', 'a person confirmed the email arrived', at);
        record(gwSent[0].msg, true);
      }
      return true;
    }

    push('start', 'runtime', 'Start', START[o.mode], 'job started');
    if (!runFrom(0)) {
      var next = restart();
      if (o.mode === 'idempotent' && store.send) {
        if (!recover()) return steps;
      } else {
        runFrom(next);
      }
    }
    var extraFetch = c.fetchTotal - 3;
    var extraModel = c.model - 1;
    var rerun = restarted && !ckpt;  // the whole job ran twice
    var parts = [inbox.length === 1 ? 'Exactly one email went out.' : inbox.length + ' emails went out, so the team got the report twice.'];
    if (rerun) parts.push('The worker also redid ' + extraFetch + ' fetches' + (extraModel ? ' and ' + extraModel + ' model call' : '') + '.');
    else if (extraFetch) parts.push('Only fetch C ran twice, because its first try never finished.');
    push('done', 'runtime', 'Done', parts.join(' '), 'job finished', { verdict: inbox.length > 1 ? 'bad' : rerun ? 'mid' : 'ok' });
    return steps;
  }

  AC.sims['durable'] = { options: OPTIONS, build: build };

  /* ---------- widget ---------- */

  var ACTOR = {
    runtime: ['runtime', 'Worker'], tool: ['tool', 'Tool'], gateway: ['tool', 'Email service'], model: ['model', 'Model'],
    store: ['state', 'Disk'], human: ['human', 'Person'], crash: ['du-crash', 'Crash']
  };
  var VERDICT = { ok: ['ok', 'One email'], mid: ['mid', 'One email, but work was redone'], bad: ['bad', 'Duplicate email'] };

  function badge(actor) {
    var a = ACTOR[actor] || ['runtime', actor];
    return AC.h('span', { class: 'badge ' + a[0], text: a[1] });
  }

  function stepStatus(s, key) {
    if (s.at === key && s.kind === 'crash') return ['crash', 'crashed here'];
    if (s.store) {
      if (key === 'send_email' && s.store.send) return s.store.send.state === 'confirmed' ? ['saved', 'done, saved'] : ['pending', 'saved as ' + s.store.send.state];
      if (s.store.done[key]) return ['saved', 'done, saved'];
    }
    if (s.memory[key]) return ['mem', 'done, only in memory'];
    if (s.at === key) return ['', 'in progress'];
    return ['', 'not done'];
  }

  AC.widgets['durable'] = function (root) {
    var h = AC.h;
    var o = clone(DEFAULTS);
    var choice = null;
    var steps = build(o);
    function rebuild() { o.onUnknown = choice; steps = build(o); }

    var frame = h('div', { class: 'w-frame du' });
    frame.appendChild(h('div', { class: 'w-head' },
      h('p', { class: 'w-title', text: root.getAttribute('data-title') || 'Crash and restart a nightly report job' }),
      h('p', { class: 'w-sub', text: 'Pick a setup, then press Next. Times and numbers are made up.' })));
    var body = h('div', { class: 'w-body' });
    frame.appendChild(body);

    var setup = h('div', { class: 'du-setup' });
    Object.keys(OPTIONS).forEach(function (k) {
      var id = AC.uid('du-' + k);
      var sel = h('select', { id: id });
      OPTIONS[k].choices.forEach(function (c) {
        var opt = h('option', { value: c[0], text: c[1] });
        opt.selected = c[0] === o[k];
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () { o[k] = sel.value; stepper.reset(); });
      setup.appendChild(h('div', { class: 'du-field' }, h('label', { for: id, text: OPTIONS[k].label }), sel));
    });
    body.appendChild(setup);

    var flow = h('ol', { class: 'du-flow', 'aria-label': 'The job steps and what is saved' });
    var inboxBox = h('div', { class: 'du-inbox-box' });
    var stats = h('div', { class: 'du-stats' });
    var timeline = h('div', { class: 'w-panel du-panel' });
    var memPanel = h('div', { class: 'w-panel du-panel' });
    var gwPanel = h('div', { class: 'w-panel du-panel' });

    function title(text, hint, extraClass) {
      var out = [h('p', { class: 'w-panel-title' + (extraClass ? ' ' + extraClass : ''), text: text })];
      if (hint) out.push(h('p', { class: 'du-hint', text: hint }));
      return out;
    }

    function render(i, narration) {
      var s = steps[i];
      narration.appendChild(h('p', { class: 'du-say' }, badge(s.actor), h('span', { class: 'w-step-title', text: s.title + '. ' }), s.say));
      if (s.choice) {
        var box = h('div', { class: 'du-choices', role: 'group', 'aria-label': 'What should the worker do?' });
        s.choice.forEach(function (c) {
          var b = h('button', { class: 'w-btn' + (s.chosen ? '' : ' primary'), type: 'button', 'aria-pressed': String(s.chosen === c.key), text: c.label });
          b.addEventListener('click', function () { choice = c.key; rebuild(); stepper.go(i + 1); });
          box.appendChild(b);
        });
        narration.appendChild(box);
      }
      if (s.verdict) {
        var v = VERDICT[s.verdict];
        narration.appendChild(h('p', { class: 'du-verdict' }, h('span', { class: 'w-status ' + v[0], text: v[1] })));
      }

      flow.textContent = '';
      WORKFLOW.forEach(function (key) {
        var st = stepStatus(s, key);
        var cls = 'du-step' + (st[0] ? ' is-' + st[0] : '') + (s.at === key && s.kind !== 'crash' ? ' is-current' : '');
        flow.appendChild(h('li', { class: cls }, h('span', { class: 'du-step-name', text: LABEL[key] }), h('span', { class: 'du-step-state', text: st[1] })));
      });

      var n = s.inbox.length;
      inboxBox.className = 'du-inbox-box' + (n > 1 ? ' is-dup' : '');
      inboxBox.textContent = '';
      inboxBox.appendChild(h('span', { class: 'du-inbox-title', text: 'Team\'s inbox' }));
      inboxBox.appendChild(h('span', { class: 'du-inbox-count', text: n === 0 ? 'No email yet' : n === 1 ? '1 email' : n + ' emails: the report arrived twice' }));

      stats.textContent = '';
      [[s.counters.fetchTotal, 'fetches run (3 needed)'], [s.counters.model, 'model calls (1 needed)']].forEach(function (x) {
        stats.appendChild(h('span', { class: 'du-stat' }, h('span', { class: 'du-stat-num', text: String(x[0]) }), h('span', { class: 'du-stat-label', text: x[1] })));
      });

      timeline.textContent = '';
      title('What happened').forEach(function (e) { timeline.appendChild(e); });
      var log = h('ol', { class: 'w-log' });
      for (var k = 0; k <= i; k++) {
        if (k && steps[k].restarted && !steps[k - 1].restarted) log.appendChild(h('li', { class: 'du-sep', text: 'After the restart' }));
        log.appendChild(h('li', { class: k === i ? 'current' : null }, badge(steps[k].log.actor), steps[k].log.text));
      }
      timeline.appendChild(log);
      log.scrollTop = log.scrollHeight;

      memPanel.textContent = '';
      title('In the worker\'s memory', 'Lost in a crash').forEach(function (e) { memPanel.appendChild(e); });
      var keys = Object.keys(s.memory);
      if (keys.length) {
        var dl = h('dl', { class: 'w-kv' });
        keys.forEach(function (k) { dl.appendChild(h('dt', { text: MEMORY_LABEL[k] || k })); dl.appendChild(h('dd', { text: s.memory[k] })); });
        memPanel.appendChild(dl);
      } else {
        memPanel.appendChild(h('p', { class: 'du-empty', text: s.kind === 'crash' ? 'Empty. The worker just crashed.' : 'Empty.' }));
      }
      title('Saved on disk', 'Survives a crash', 'du-sub').forEach(function (e) { memPanel.appendChild(e); });
      if (s.store) {
        var saved = h('dl', { class: 'w-kv' });
        var row = function (k, v) { saved.appendChild(h('dt', { text: k })); saved.appendChild(h('dd', { text: v })); };
        row('Run', s.store.run);
        Object.keys(s.store.done).forEach(function (k) { row(MEMORY_LABEL[k] || k, s.store.done[k]); });
        if (s.store.send) {
          var e = s.store.send;
          row('Email record', e.op_id + ': ' + e.state + (e.message_id ? ' (' + e.message_id + ')' : '') + (e.confirmed_by ? ' by a person' : ''));
        }
        memPanel.appendChild(saved);
      } else {
        memPanel.appendChild(h('p', { class: 'du-empty', text: 'Nothing. This worker saves nothing.' }));
      }

      gwPanel.textContent = '';
      title('What the email service did').forEach(function (e) { gwPanel.appendChild(e); });
      if (s.gatewayLog.length) {
        var gl = h('ol', { class: 'w-log' });
        s.gatewayLog.forEach(function (e) { gl.appendChild(h('li', { text: e.text })); });
        gwPanel.appendChild(gl);
      } else {
        gwPanel.appendChild(h('p', { class: 'du-empty', text: 'No requests yet.' }));
      }
      title('Emails in the inbox', null, 'du-sub').forEach(function (e) { gwPanel.appendChild(e); });
      if (n) {
        var ul = h('ul', { class: 'du-inbox' });
        s.inbox.forEach(function (m) {
          ul.appendChild(h('li', { class: 'du-mail' + (m.duplicate ? ' is-dup' : '') },
            h('span', { class: 'du-mail-head' }, h('strong', { text: m.subject }), ' ', h('span', { class: 'w-muted', text: m.id }),
              m.duplicate ? h('span', { class: 'w-status bad', text: 'duplicate' }) : null),
            h('span', { class: 'du-mail-body', text: m.body })));
        });
        gwPanel.appendChild(ul);
      } else {
        gwPanel.appendChild(h('p', { class: 'du-empty', text: 'Empty.' }));
      }
    }

    var stepper = AC.stepper({
      count: function () { return steps.length; },
      render: render,
      blocked: function (i) { return steps[i].kind === 'choice' && !steps[i].chosen; },
      onReset: function () { choice = null; rebuild(); },
      playDelay: 2200
    });
    body.appendChild(stepper.el);
    body.appendChild(h('div', { class: 'du-picture' }, flow, inboxBox));
    body.appendChild(stats);
    body.appendChild(h('div', { class: 'w-grid cols-3 du-details' }, timeline, memPanel, gwPanel));
    root.appendChild(frame);
    stepper.go(0);
  };
})();
