/* Step-through agent loop (chapter 01; reused in 09 and 11 via data-scenarios="coding" or "approval").
   AC.sims['agent-loop'].build(key, choices) expands a scenario script into steps. It is pure and tested
   by tools/sims/agent-loop.test.mjs. Token counts are illustrative. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  var DEFAULT_CTX = 'Your code builds the context again from its state: instructions, tool descriptions, and the full history so far.';

  var SCENARIOS = {
    answer: {
      label: 'Answer from knowledge',
      user: 'What is the difference between a process and a thread?',
      userTokens: 15,
      fixed: [
        { kind: 'runtime', label: 'System prompt', tokens: 1100 },
        { kind: 'tool', label: 'Tool definitions (3 tools)', tokens: 700 }
      ],
      state: {},
      userSay: 'Your code stores the message. Nothing has gone to the model yet.',
      script: [{
        ctxSay: 'Your code puts together the context: the instructions, the tool descriptions, and the message. This is everything the model will see.',
        final: 'A process has its own memory space. Threads run inside a process and share its memory, so they are cheaper to create but need locks to avoid clashing.',
        finalTokens: 60,
        say: 'The model reads the context and writes an answer. It asks for no tool, which means it thinks the work is done.',
        stopSay: 'There is nothing to run, so your code saves the answer and stops the loop. That took one model call and no tools.'
      }]
    },

    coding: {
      label: 'Fix a failing test',
      user: 'The auth test is failing. Please fix it.',
      userTokens: 12,
      fixed: [
        { kind: 'runtime', label: 'System prompt', tokens: 1100 },
        { kind: 'tool', label: 'Tool definitions: search_files, read_file, edit_file, run_command', tokens: 900 },
        { kind: 'state', label: 'Project instructions (AGENTS.md)', tokens: 400 }
      ],
      state: { last_test: 'unknown', files_read: [], files_changed: [] },
      userSay: 'Your code stores the request. The model has not seen it yet. Nothing happens until your code calls the model.',
      script: [
        {
          ctxSay: 'Your code puts together the first context: the instructions, the tool descriptions, the project notes, and the request.',
          call: { name: 'run_command', args: { cmd: 'pytest tests/test_auth.py -q' } },
          say: 'The model wants to see the failure before guessing, so it asks to run the tests. This is only a request. The model cannot run anything.',
          actSay: 'Your code checks the request against the tool description and its rules. Test commands are allowed, so it runs the tests. One test fails.',
          result: 'FAILED tests/test_auth.py::test_login_expired_token\nassert 200 == 401\n1 failed, 11 passed',
          resultShort: 'exit 1, 1 failed',
          resultTokens: 380,
          updateSay: 'Your code adds the test output to the history, labeled as the answer to request call_1. The model has not seen it yet.',
          update: { last_test: 'failed (1 of 12)' }
        },
        {
          ctxSay: 'Your code builds the context again from scratch. This time it includes the first request and the test output. The model does not remember call 1, so it has to read it again.',
          call: { name: 'read_file', args: { path: 'auth/session.py' } },
          say: 'Now that it can see the error, the model asks to read the session code.',
          actSay: 'Reading a file inside the project is allowed, so your code reads it.',
          result: 'def is_valid(token, now):\n    return token.expires_at >= now - timedelta(minutes=10)\n...',
          resultShort: '120 lines',
          resultTokens: 1400,
          updateSay: 'The file goes into the history as the answer to call_2. Notice how fast the context is growing.',
          update: { files_read: ['auth/session.py'] }
        },
        {
          ctxSay: 'Same pattern again: each call sends everything so far. Caching can make the repeated part cheaper, but not shorter.',
          call: { name: 'edit_file', args: { path: 'auth/session.py', old: 'token.expires_at >= now - timedelta(minutes=10)', new: 'token.expires_at > now' } },
          say: 'The model spots the bug: an old 10-minute grace period lets expired tokens through. It asks to edit that line.',
          actSay: 'Your code makes sure the old text appears exactly once in the file, makes the change, and notes which file changed.',
          result: 'Replaced 1 occurrence in auth/session.py',
          resultShort: '1 replacement',
          resultTokens: 25,
          updateSay: 'The confirmation goes into the history as the answer to call_3. Your code also keeps its own list of changed files.',
          update: { files_changed: ['auth/session.py'] }
        },
        {
          ctxSay: 'The context now also includes the edit and its confirmation.',
          call: { name: 'run_command', args: { cmd: 'pytest tests/test_auth.py -q' } },
          say: 'The model asks to run the tests again, to check that the fix works.',
          actSay: 'Allowed, as before. Your code runs the tests, and this time they all pass.',
          result: '12 passed in 0.41s',
          resultShort: 'exit 0, 12 passed',
          resultTokens: 40,
          updateSay: 'The passing output goes into the history as the answer to call_4.',
          update: { last_test: 'passed (12 of 12)' }
        },
        {
          ctxSay: 'Your code builds the context one more time, now with the passing test output.',
          final: 'Fixed. auth/session.py kept a 10-minute grace period, so a token that expired a minute ago still counted as valid. The check is now token.expires_at > now. All 12 auth tests pass.',
          finalTokens: 70,
          say: 'The model writes a summary and asks for no tool. That means it thinks the task is done. It is not proof.',
          stopSay: 'The reply asks for nothing, so your code stops the loop. Stopping is not the same as succeeding.',
          verify: 'Your code checks the evidence it saved: the last test run passed, 12 out of 12. Now the task counts as done.',
          verifyLog: 'last test run passed'
        }
      ]
    },

    approval: {
      label: 'Dangerous action',
      user: 'The sessions_2023 table takes 41 GB. Clean it up.',
      userTokens: 14,
      fixed: [
        { kind: 'runtime', label: 'System prompt', tokens: 1100 },
        { kind: 'tool', label: 'Tool definitions: run_sql, archive_table, list_tables', tokens: 750 }
      ],
      state: { pending: null },
      userSay: 'Your code stores the request. This agent can change a real database, so your code has rules for risky requests.',
      script: [{
        ctxSay: 'Your code puts together the context: the instructions, the tool descriptions, and the request.',
        call: { name: 'run_sql', args: { sql: 'DROP TABLE sessions_2023;' } },
        say: 'The model suggests the quickest fix: delete the whole table. It is a request like any other.',
        policy: { verdict: 'approval' },
        blockSay: 'Your code checks the SQL against its rules: DROP, DELETE, and TRUNCATE need a person to approve them. The rule lives in code, not in the prompt, so no wording can get past it. Nothing runs.',
        checkpointSay: 'Your code saves the run to disk: the history, the step count, and the exact request that is waiting. The program could even shut down now and continue tomorrow.',
        choiceSay: 'You are asked to approve this exact request: DROP TABLE sessions_2023. Approve it, or reject it and say why.',
        choices: [{ key: 'approve', label: 'Approve the DROP' }, { key: 'reject', label: 'Reject: archive it first' }],
        gate: {
          approve: {
            resumeSay: 'Your code loads the saved run and confirms that the approved request is the one that was waiting. Only then does it run the SQL.',
            result: 'DROP TABLE: done (41 GB freed). Approved by the user.',
            resultTokens: 20,
            updateSay: 'The result, including who approved it, goes into the history as the answer to call_1.',
            then: [{
              ctxSay: 'Your code builds the context again, now with the result.',
              final: 'Dropped sessions_2023 after your approval. 41 GB freed.',
              finalTokens: 20,
              say: 'The model reports what happened and asks for nothing more.',
              stopSay: 'Nothing more is requested, so your code stops the loop.'
            }]
          },
          reject: {
            resumeSay: 'Your code loads the saved run. It does not run the SQL. Instead it records your rejection as the answer to call_1, so the model can react to it.',
            result: 'Rejected by the user: do not drop it. Archive it to cold storage first.',
            resultTokens: 20,
            updateSay: 'Your rejection is now part of the history. To the model, it looks like any other tool result.',
            then: [
              {
                ctxSay: 'Your code builds the context again, with the rejection in it.',
                call: { name: 'archive_table', args: { table: 'sessions_2023', to: 's3://archive/sessions_2023/' } },
                say: 'The model reads your feedback and suggests a safer step: copy the table to cheap long-term storage first.',
                actSay: 'A new request gets its own check. Copying deletes nothing, so the rules allow it without approval, and your code runs it.',
                result: 'Archived 41 GB to s3://archive/sessions_2023/ (table still present)',
                resultShort: 'archived 41 GB',
                resultTokens: 30,
                updateSay: 'The copy result goes into the history as the answer to call_2.'
              },
              {
                ctxSay: 'Your code builds the context one more time, with the copy result.',
                final: 'I did not drop the table. I archived it to s3://archive/sessions_2023/. Once you have checked the archive, I can drop the table with your approval.',
                finalTokens: 40,
                say: 'The model sums up and asks for nothing more.',
                stopSay: 'Nothing more is requested, so your code stops the loop. The DROP never ran.'
              }
            ]
          }
        }
      }]
    }
  };

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function argSummary(args) { return Object.keys(args).map(function (k) { return args[k]; }).join(', '); }
  function sig(call) {
    var s = call.name + '(' + JSON.stringify(call.args) + ')';
    return s.length > 90 ? s.slice(0, 86) + '...)' : s;
  }

  function build(key, choices) {
    var sc = SCENARIOS[key];
    if (!sc) throw new Error('unknown scenario: ' + key);
    choices = choices || {};
    var steps = [];
    var st = { status: 'running', step: 0, max_steps: 30, messages: [] };
    Object.keys(sc.state).forEach(function (k) { st[k] = clone(sc.state[k]); });
    var executed = [];
    var c = { modelCalls: 0, toolCalls: 0, ctxTokens: 0, totalTokens: 0 };
    var seq = 0;

    function push(kind, nodes, actor, title, say, logText, extra) {
      var s = {
        kind: kind, nodes: nodes, actor: actor, title: title, say: say,
        log: { actor: actor, text: logText },
        state: clone(st), context: null, counters: clone(c), executed: executed.slice()
      };
      if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
      steps.push(s);
    }

    function contextBlocks() {
      var out = sc.fixed.map(clone);
      st.messages.forEach(function (m) {
        if (m.role === 'user') out.push({ kind: 'user', label: 'User: ' + m.text, tokens: m.tokens });
        else if (m.role === 'assistant') out.push({ kind: 'model', label: m.call ? 'Assistant requests ' + sig(m.call) + ' [' + m.call.id + ']' : 'Assistant: ' + m.text, tokens: m.tokens });
        else out.push({ kind: 'tool', label: 'Tool result [' + m.tool_call_id + ']: ' + m.text.split('\n')[0], tokens: m.tokens });
      });
      return out;
    }

    function run(items) {
      for (var n = 0; n < items.length; n++) {
        var it = items[n];
        var ctx = contextBlocks();
        c.ctxTokens = ctx.reduce(function (a, b) { return a + b.tokens; }, 0);
        push('context', ['context'], 'runtime', 'Build context', it.ctxSay || DEFAULT_CTX,
          'Runtime: built the context (' + ctx.length + ' parts, about ' + fmt(c.ctxTokens) + ' tokens)', { context: ctx });
        c.modelCalls += 1;
        c.totalTokens += c.ctxTokens;
        st.step += 1;

        if (it.final) {
          push('propose', ['model', 'decide'], 'model', 'Call model', it.say, 'Model: final answer, no tool requested', { context: ctx, decision: { final: it.final } });
          st.messages.push({ role: 'assistant', text: it.final, tokens: it.finalTokens || 60 });
          st.status = it.verify ? 'stopped' : 'done';
          push('stop', ['update'], 'runtime', 'Stop the loop', it.stopSay, 'Runtime: nothing requested, so the loop stops');
          if (it.verify) {
            st.status = 'done';
            push('verify', ['state'], 'runtime', 'Check the evidence', it.verify, 'Runtime: success confirmed (' + it.verifyLog + ')');
          }
          return;
        }

        seq += 1;
        var call = { id: 'call_' + seq, name: it.call.name, args: clone(it.call.args) };
        push('model', ['model', 'decide'], 'model', 'Call model', it.say, 'Model: requests ' + sig(call), { context: ctx, decision: { call: call } });
        st.messages.push({ role: 'assistant', call: call, text: sig(call), tokens: 40 });

        if (it.policy && it.policy.verdict === 'approval') {
          push('blocked', ['act'], 'runtime', 'A rule blocks the request', it.blockSay, 'Runtime: blocked ' + call.name + ', approval needed');
          st.status = 'waiting_for_approval';
          st.pending = { id: call.id, name: call.name, args: clone(call.args) };
          push('checkpoint', ['update'], 'runtime', 'Save and wait', it.checkpointSay, 'Runtime: saved the run, ' + call.id + ' is waiting');
          var decided = choices.gate && it.gate[choices.gate] ? choices.gate : null;
          var label = decided ? it.choices.filter(function (o) { return o.key === decided; })[0].label : '';
          push('choice', ['act'], 'human', 'A person decides',
            decided ? it.choiceSay + ' You chose: ' + label + '.' : it.choiceSay,
            decided ? 'Human: ' + label : 'Human: asked to approve ' + call.id,
            { choice: it.choices, chosen: decided });
          if (!decided) return;
          var br = it.gate[decided];
          st.status = 'running';
          if (decided === 'approve') {
            if (JSON.stringify(st.pending.args) !== JSON.stringify(call.args)) throw new Error('approved call differs from the pending call');
            executed.push(call.name + ': ' + argSummary(call.args));
            c.toolCalls += 1;
            push('resume', ['act'], 'runtime', 'Continue and run it', br.resumeSay, 'Runtime: ran the approved ' + call.id);
          } else {
            push('resume', ['act'], 'runtime', 'Continue without running it', br.resumeSay, 'Runtime: ' + call.id + ' rejected, did not run it');
          }
          st.pending = null;
          st.messages.push({ role: 'tool', tool_call_id: call.id, text: br.result, tokens: br.resultTokens || 20 });
          push('update', ['update'], 'runtime', 'Add the result to the history', br.updateSay, 'Runtime: added the result of ' + call.id + ' to the history');
          run(br.then);
          return;
        }

        executed.push(call.name + ': ' + argSummary(call.args));
        c.toolCalls += 1;
        push('act', ['act'], 'runtime', 'Check and run the tool', it.actSay, 'Runtime: ran ' + call.name + ' → ' + it.resultShort);
        st.messages.push({ role: 'tool', tool_call_id: call.id, text: it.result, tokens: it.resultTokens });
        if (it.update) Object.keys(it.update).forEach(function (k) { st[k] = clone(it.update[k]); });
        push('update', ['update'], 'runtime', 'Add the result to the history', it.updateSay, 'Runtime: added the result of ' + call.id + ' to the history');
      }
    }

    st.messages.push({ role: 'user', text: sc.user, tokens: sc.userTokens });
    push('user', ['state'], 'user', 'The user sends a message', sc.userSay, 'User: ' + sc.user);
    run(sc.script);
    return steps;
  }

  AC.sims['agent-loop'] = { scenarios: SCENARIOS, build: build };

  /* ---------- widget ---------- */

  var PILL = { runtime: 'your code', tool: 'tool', state: 'file', user: 'user', model: 'model' };
  var ACTOR = { runtime: 'Runtime', model: 'Model', user: 'User', human: 'Human', tool: 'Tool' };

  function stateRows(st) {
    var rows = [['status', st.status.replace(/_/g, ' ')], ['step', st.step + ' (limit ' + st.max_steps + ')']];
    var roles = { user: 0, assistant: 0, tool: 0 };
    st.messages.forEach(function (m) { roles[m.role] += 1; });
    rows.push(['messages', st.messages.length + ' (user ' + roles.user + ', assistant ' + roles.assistant + ', tool ' + roles.tool + ')']);
    Object.keys(st).forEach(function (k) {
      if (['status', 'step', 'max_steps', 'messages'].indexOf(k) !== -1) return;
      var v = st[k];
      if (v == null) v = 'none';
      else if (Array.isArray(v)) v = v.length ? v.join(', ') : '[]';
      else if (typeof v === 'object') v = v.id + ' ' + v.name + ' ' + JSON.stringify(v.args);
      rows.push([k, String(v)]);
    });
    return rows;
  }

  AC.widgets['agent-loop'] = function (root) {
    var h = AC.h;
    var keys = (root.getAttribute('data-scenarios') || 'answer,coding,approval').split(',')
      .map(function (s) { return s.trim(); }).filter(function (k) { return SCENARIOS[k]; });
    if (!keys.length) keys = ['coding'];
    var start = root.getAttribute('data-start');
    var current = keys.indexOf(start) !== -1 ? start : keys[0];
    var choices = {};
    var steps = build(current, choices);

    var title = root.getAttribute('data-title') || 'The agent loop, step by step';
    var frame = h('div', { class: 'w-frame' });
    frame.appendChild(h('div', { class: 'w-head' }, h('p', { class: 'w-title', text: title }), h('p', { class: 'w-sub', text: 'Press Next to move one step. Token counts are made up but realistic.' })));
    var body = h('div', { class: 'w-body' });
    frame.appendChild(body);

    var tabs = null;
    if (keys.length > 1) {
      tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Scenario' });
      keys.forEach(function (k) {
        var b = h('button', { class: 'w-tab', type: 'button', 'aria-selected': String(k === current), 'data-key': k, text: SCENARIOS[k].label });
        b.addEventListener('click', function () {
          if (k === current) return;
          current = k;
          choices = {};
          steps = build(current, choices);
          tabs.querySelectorAll('.w-tab').forEach(function (t) { t.setAttribute('aria-selected', String(t.getAttribute('data-key') === k)); });
          paintRequest();
          stepper.reset();
        });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
    }

    var request = h('p', { class: 'al-request' });
    body.appendChild(request);
    function paintRequest() {
      request.textContent = '';
      request.appendChild(h('span', { class: 'badge user', text: 'User' }));
      request.appendChild(document.createTextNode(SCENARIOS[current].user));
    }
    paintRequest();

    var top = h('div', { class: 'al-top' });
    var loopBox = h('div', { class: 'al-loop', 'aria-hidden': 'true' });
    var grid = AC.renderLoop(loopBox, [], { big: true });
    grid.classList.add('has-active');
    top.appendChild(loopBox);
    body.appendChild(top);

    var counters = h('div', { class: 'al-stats', 'aria-label': 'Counters' });
    body.appendChild(counters);

    var statePanel = h('div', { class: 'w-panel al-panel' });
    var ctxPanel = h('div', { class: 'w-panel al-panel' });
    var logPanel = h('div', { class: 'w-panel al-panel' });
    body.appendChild(h('div', { class: 'w-grid cols-3' }, statePanel, ctxPanel, logPanel));

    function render(i, narration) {
      var s = steps[i];
      var prev = i > 0 ? steps[i - 1] : null;

      grid.querySelectorAll('.lm-node').forEach(function (n) {
        n.classList.toggle('is-active', s.nodes.indexOf(n.getAttribute('data-key')) !== -1);
      });

      var head = h('p', { class: 'al-say' },
        h('span', { class: 'badge ' + (s.actor === 'human' ? 'human' : s.actor), text: ACTOR[s.actor] || s.actor }),
        h('span', { class: 'w-step-title', text: s.title + '. ' }), s.say);
      narration.appendChild(head);
      if (s.decision) {
        var out = s.decision.call ? 'The model asks for ' + sig(s.decision.call) + ' (request ' + s.decision.call.id + ')' : 'Final answer. No tool requested.';
        narration.appendChild(h('p', { class: 'al-decision', text: out }));
      }
      if (s.choice) {
        var box = h('div', { class: 'al-choices', role: 'group', 'aria-label': 'Your decision' });
        s.choice.forEach(function (o) {
          var b = h('button', { class: 'w-btn' + (s.chosen ? '' : ' primary'), type: 'button', 'aria-pressed': String(s.chosen === o.key), text: o.label });
          b.addEventListener('click', function () {
            choices.gate = o.key;
            steps = build(current, choices);
            stepper.go(i + 1);
          });
          box.appendChild(b);
        });
        narration.appendChild(box);
      }

      counters.textContent = '';
      [['Model calls', s.counters.modelCalls], ['Tools run', s.counters.toolCalls],
        ['Tokens sent so far, all calls', fmt(s.counters.totalTokens)]].forEach(function (c) {
        counters.appendChild(h('span', { class: 'al-stat' }, h('span', { class: 'al-stat-num', text: String(c[1]) }), h('span', { class: 'al-stat-label', text: c[0] })));
      });

      statePanel.textContent = '';
      statePanel.appendChild(h('p', { class: 'w-panel-title', text: 'What your code remembers' }));
      var dl = h('dl', { class: 'w-kv' });
      var prevRows = prev ? stateRows(prev.state) : [];
      stateRows(s.state).forEach(function (r) {
        var old = prevRows.filter(function (p) { return p[0] === r[0]; })[0];
        var changed = prev && (!old || old[1] !== r[1]);
        dl.appendChild(h('dt', { text: r[0] }));
        dl.appendChild(h('dd', { class: changed ? 'changed' : null, text: r[1] }));
      });
      dl.appendChild(h('dt', { text: 'tools run' }));
      dl.appendChild(h('dd', { text: s.executed.length ? s.executed.join(' | ') : 'none' }));
      statePanel.appendChild(dl);

      ctxPanel.textContent = '';
      ctxPanel.appendChild(h('p', { class: 'w-panel-title', text: 'What the model sees right now' }));
      if (s.context) {
        ctxPanel.appendChild(h('p', { class: 'al-ctx-total', text: 'About ' + fmt(s.counters.ctxTokens) + ' tokens sent in this call' }));
        var ol = h('ol', { class: 'al-ctx-list' });
        s.context.forEach(function (b) {
          ol.appendChild(h('li', null,
            h('span', { class: 'w-pill ' + b.kind, text: PILL[b.kind] || b.kind }),
            h('span', { class: 'al-ctx-label', title: b.label, text: b.label }),
            h('span', { class: 'al-ctx-tok', text: fmt(b.tokens) })));
        });
        ctxPanel.appendChild(ol);
      } else {
        ctxPanel.appendChild(h('p', { class: 'al-idle', text: 'Nothing. The model is not running right now. Your code keeps the state, and it will send everything again on the next call.' }));
      }

      logPanel.textContent = '';
      logPanel.appendChild(h('p', { class: 'w-panel-title', text: 'What happened so far' }));
      var log = h('ol', { class: 'w-log' });
      for (var k = 0; k <= i; k++) {
        var e = steps[k].log;
        log.appendChild(h('li', { class: k === i ? 'current' : null },
          h('span', { class: 'badge ' + (e.actor === 'human' ? 'human' : e.actor), text: ACTOR[e.actor] || e.actor }), e.text.replace(/^\w+: /, '')));
      }
      logPanel.appendChild(log);
      log.scrollTop = log.scrollHeight;
    }

    var stepper = AC.stepper({
      count: function () { return steps.length; },
      render: render,
      blocked: function (i) { return steps[i].kind === 'choice' && !steps[i].chosen; },
      onReset: function () { choices = {}; steps = build(current, choices); }
    });
    top.appendChild(stepper.el);
    root.appendChild(frame);
    stepper.go(0);
  };
})();
