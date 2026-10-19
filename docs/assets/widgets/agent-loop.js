/* Step-through agent loop (chapter 01; reused in 09 and 11 via data-scenarios="coding" or "approval").
   AC.sims['agent-loop'].build(key, choices) expands a scenario script into steps. It is pure and tested
   by tools/sims/agent-loop.test.mjs. Token counts are illustrative. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  var DEFAULT_CTX = 'The runtime rebuilds the context from its state: instructions, tool definitions, and the full history so far.';

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
      userSay: 'The runtime stores the message in its state. Nothing has gone to the model yet.',
      script: [{
        ctxSay: 'The runtime assembles the context: system prompt, tool definitions, and the message. This is everything the model will see.',
        final: 'A process has its own memory space. Threads run inside a process and share its memory, so they are cheaper to create but need locks to avoid clashing.',
        finalTokens: 60,
        say: 'The model reads the whole context and writes a reply. It requests no tool, so the reply proposes that the work is done.',
        stopSay: 'No tool calls means nothing to execute. The runtime appends the reply and stops the loop. One model call, zero tool calls.'
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
      userSay: 'The runtime stores the request. The model has not seen it yet. Nothing happens until the runtime calls the model.',
      script: [
        {
          ctxSay: 'The runtime assembles the first context: system prompt, tool definitions, project instructions, and the request.',
          call: { name: 'run_command', args: { cmd: 'pytest tests/test_auth.py -q' } },
          say: 'The model chooses to reproduce the failure before guessing. Its output is a structured request to run a command. It runs nothing itself.',
          actSay: 'The runtime checks the arguments against the tool schema and its policy (test commands are allowed). It runs the command in the sandbox. Exit code 1.',
          result: 'FAILED tests/test_auth.py::test_login_expired_token\nassert 200 == 401\n1 failed, 11 passed',
          resultShort: 'exit 1, 1 failed',
          resultTokens: 380,
          updateSay: 'The output becomes a tool result tied to call_1 and joins the history. The model has not seen it yet.',
          update: { last_test: 'failed (1 of 12)' }
        },
        {
          ctxSay: 'The runtime rebuilds the context from scratch. It now holds the first tool call and its result. The model does not remember call 1. It reads it again.',
          call: { name: 'read_file', args: { path: 'auth/session.py' } },
          say: 'With the error in view, the model asks for the session code.',
          actSay: 'A read-only tool inside the workspace, so the policy allows it. The runtime reads the file.',
          result: 'def is_valid(token, now):\n    return token.expires_at >= now - timedelta(minutes=10)\n...',
          resultShort: '120 lines',
          resultTokens: 1400,
          updateSay: 'The file contents join the history as the result of call_2. Notice how fast the context grows.',
          update: { files_read: ['auth/session.py'] }
        },
        {
          ctxSay: 'Same pattern again. Each call re-sends everything so far. Prompt caching can make the repeated prefix cheaper. It does not make it smaller.',
          call: { name: 'edit_file', args: { path: 'auth/session.py', old: 'token.expires_at >= now - timedelta(minutes=10)', new: 'token.expires_at > now' } },
          say: 'The model forms a hypothesis: a leftover 10-minute grace period keeps expired tokens valid. The hypothesis is just text. The edit is a request.',
          actSay: 'The runtime validates the edit: the old text must match exactly once. It applies the change and records which file changed.',
          result: 'Replaced 1 occurrence in auth/session.py',
          resultShort: '1 replacement',
          resultTokens: 25,
          updateSay: 'The confirmation joins the history as the result of call_3. The runtime also tracks the changed file in its own state.',
          update: { files_changed: ['auth/session.py'] }
        },
        {
          ctxSay: 'The context now includes the edit and its confirmation.',
          call: { name: 'run_command', args: { cmd: 'pytest tests/test_auth.py -q' } },
          say: 'The model asks for the tests again. A claim of success needs evidence from the environment.',
          actSay: 'Allowed, as before. The runtime runs the tests. Exit code 0.',
          result: '12 passed in 0.41s',
          resultShort: 'exit 0, 12 passed',
          resultTokens: 40,
          updateSay: 'The passing output joins the history as the result of call_4.',
          update: { last_test: 'passed (12 of 12)' }
        },
        {
          ctxSay: 'One more rebuild, now with the passing test output.',
          final: 'Fixed. auth/session.py kept a 10-minute grace period, so a token that expired a minute ago still counted as valid. The check is now token.expires_at > now. All 12 auth tests pass.',
          finalTokens: 70,
          say: 'The model writes a summary and requests no tool. That is a proposal that the task is done, not proof.',
          stopSay: 'The runtime stops the loop because the reply asks for nothing. Stopping is not the same as succeeding.',
          verify: 'The runtime checks its done criteria against evidence in state: the last test run passed (12 of 12). Now the task counts as done.',
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
      userSay: 'The runtime stores the request. This agent can touch a real database, so its runtime has a policy for risky calls.',
      script: [{
        ctxSay: 'The runtime assembles the context: system prompt, tool definitions, and the request.',
        call: { name: 'run_sql', args: { sql: 'DROP TABLE sessions_2023;' } },
        say: 'The model proposes the most direct fix: drop the table. It is a request like any other.',
        policy: { verdict: 'approval' },
        blockSay: 'The tool dispatcher checks the SQL against its policy: DROP, DELETE, and TRUNCATE need approval. The rule lives in code, not in the prompt, so no wording gets past it. Nothing executes.',
        checkpointSay: 'The runtime saves the run: history, step count, and the exact pending call. The process could exit now and resume tomorrow.',
        choiceSay: 'The approval request is bound to this exact call: DROP TABLE sessions_2023. Approve it, or reject it with feedback.',
        choices: [{ key: 'approve', label: 'Approve the DROP' }, { key: 'reject', label: 'Reject: archive it first' }],
        gate: {
          approve: {
            resumeSay: 'The runtime reloads the checkpoint and confirms the approved call matches the pending one. Only then does it run the SQL.',
            result: 'DROP TABLE: done (41 GB freed). Approved by the user.',
            resultTokens: 20,
            updateSay: 'The result, including who approved it, joins the history as the result of call_1.',
            then: [{
              ctxSay: 'The runtime rebuilds the context, now with the approved result.',
              final: 'Dropped sessions_2023 after your approval. 41 GB freed.',
              finalTokens: 20,
              say: 'The model reports what happened and requests nothing more.',
              stopSay: 'No tool calls, so the runtime stops the loop.'
            }]
          },
          reject: {
            resumeSay: 'The runtime reloads the checkpoint. It does not run the SQL. It records the rejection as the result of call_1 so the model can react.',
            result: 'Rejected by the user: do not drop it. Archive it to cold storage first.',
            resultTokens: 20,
            updateSay: 'The rejection is now part of the history. To the model it looks like any other tool result.',
            then: [
              {
                ctxSay: 'The runtime rebuilds the context with the rejection in it.',
                call: { name: 'archive_table', args: { table: 'sessions_2023', to: 's3://archive/sessions_2023/' } },
                say: 'The model reads the feedback and proposes a safer step: export the table to cold storage.',
                actSay: 'A new call gets its own policy check. Exporting is not destructive, so the policy allows it without approval. The runtime runs it.',
                result: 'Archived 41 GB to s3://archive/sessions_2023/ (table still present)',
                resultShort: 'archived 41 GB',
                resultTokens: 30,
                updateSay: 'The archive result joins the history as the result of call_2.'
              },
              {
                ctxSay: 'One more rebuild with the archive result.',
                final: 'I did not drop the table. I archived it to s3://archive/sessions_2023/. Once you have checked the archive, I can drop the table with your approval.',
                finalTokens: 40,
                say: 'The model summarizes and requests nothing more.',
                stopSay: 'No tool calls, so the runtime stops the loop. The DROP never ran.'
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
          'Runtime: built context (' + ctx.length + ' blocks, ~' + fmt(c.ctxTokens) + ' tokens)', { context: ctx });
        c.modelCalls += 1;
        c.totalTokens += c.ctxTokens;
        st.step += 1;

        if (it.final) {
          push('propose', ['model', 'decide'], 'model', 'Call model', it.say, 'Model: final answer, no tool calls', { context: ctx, decision: { final: it.final } });
          st.messages.push({ role: 'assistant', text: it.final, tokens: it.finalTokens || 60 });
          st.status = it.verify ? 'stopped' : 'done';
          push('stop', ['update'], 'runtime', 'Stop the loop', it.stopSay, 'Runtime: no tool calls, loop stops');
          if (it.verify) {
            st.status = 'done';
            push('verify', ['state'], 'runtime', 'Check the evidence', it.verify, 'Runtime: done criteria met (' + it.verifyLog + ')');
          }
          return;
        }

        seq += 1;
        var call = { id: 'call_' + seq, name: it.call.name, args: clone(it.call.args) };
        push('model', ['model', 'decide'], 'model', 'Call model', it.say, 'Model: requests ' + sig(call), { context: ctx, decision: { call: call } });
        st.messages.push({ role: 'assistant', call: call, text: sig(call), tokens: 40 });

        if (it.policy && it.policy.verdict === 'approval') {
          push('blocked', ['act'], 'runtime', 'Policy check blocks the call', it.blockSay, 'Runtime: ' + call.name + ' blocked, approval required');
          st.status = 'waiting_for_approval';
          st.pending = { id: call.id, name: call.name, args: clone(call.args) };
          push('checkpoint', ['update'], 'runtime', 'Checkpoint and pause', it.checkpointSay, 'Runtime: checkpoint saved, ' + call.id + ' pending');
          var decided = choices.gate && it.gate[choices.gate] ? choices.gate : null;
          var label = decided ? it.choices.filter(function (o) { return o.key === decided; })[0].label : '';
          push('choice', ['act'], 'human', 'Human decides',
            decided ? it.choiceSay + ' You chose: ' + label + '.' : it.choiceSay,
            decided ? 'Human: ' + label : 'Human: approval requested for ' + call.id,
            { choice: it.choices, chosen: decided });
          if (!decided) return;
          var br = it.gate[decided];
          st.status = 'running';
          if (decided === 'approve') {
            if (JSON.stringify(st.pending.args) !== JSON.stringify(call.args)) throw new Error('approved call differs from the pending call');
            executed.push(call.name + ': ' + argSummary(call.args));
            c.toolCalls += 1;
            push('resume', ['act'], 'runtime', 'Resume and execute', br.resumeSay, 'Runtime: ran approved ' + call.id);
          } else {
            push('resume', ['act'], 'runtime', 'Resume with the rejection', br.resumeSay, 'Runtime: ' + call.id + ' rejected, not executed');
          }
          st.pending = null;
          st.messages.push({ role: 'tool', tool_call_id: call.id, text: br.result, tokens: br.resultTokens || 20 });
          push('update', ['update'], 'runtime', 'Add observation', br.updateSay, 'Runtime: appended result of ' + call.id);
          run(br.then);
          return;
        }

        executed.push(call.name + ': ' + argSummary(call.args));
        c.toolCalls += 1;
        push('act', ['act'], 'runtime', 'Validate and execute', it.actSay, 'Runtime: ran ' + call.name + ' → ' + it.resultShort);
        st.messages.push({ role: 'tool', tool_call_id: call.id, text: it.result, tokens: it.resultTokens });
        if (it.update) Object.keys(it.update).forEach(function (k) { st[k] = clone(it.update[k]); });
        push('update', ['update'], 'runtime', 'Add observation', it.updateSay, 'Runtime: appended result of ' + call.id);
      }
    }

    st.messages.push({ role: 'user', text: sc.user, tokens: sc.userTokens });
    push('user', ['state'], 'user', 'User message arrives', sc.userSay, 'User: ' + sc.user);
    run(sc.script);
    return steps;
  }

  AC.sims['agent-loop'] = { scenarios: SCENARIOS, build: build };

  /* ---------- widget ---------- */

  var PILL = { runtime: 'your code', tool: 'tool', state: 'file', user: 'user', model: 'model' };
  var ACTOR = { runtime: 'Runtime', model: 'Model', user: 'User', human: 'Human', tool: 'Tool' };

  function stateRows(st) {
    var rows = [['status', st.status], ['step', st.step + ' of ' + st.max_steps + ' max']];
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
    frame.appendChild(h('div', { class: 'w-head' }, h('p', { class: 'w-title', text: title }), h('p', { class: 'w-sub', text: 'Token counts are illustrative.' })));
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

    var counters = h('div', { class: 'w-counters', 'aria-label': 'Counters' });
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
        var out = s.decision.call ? 'Output: tool call ' + s.decision.call.id + ' ' + sig(s.decision.call) : 'Output: final answer, no tool calls';
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
      [['Model calls', s.counters.modelCalls], ['Tool calls run', s.counters.toolCalls],
        ['Context this call', s.context ? '~' + fmt(s.counters.ctxTokens) + ' tokens' : 'none'],
        ['Input tokens so far', '~' + fmt(s.counters.totalTokens)]].forEach(function (c) {
        counters.appendChild(h('span', { class: 'w-counter', text: c[0] + ': ' + c[1] }));
      });

      statePanel.textContent = '';
      statePanel.appendChild(h('p', { class: 'w-panel-title', text: 'Runtime state' }));
      var dl = h('dl', { class: 'w-kv' });
      var prevRows = prev ? stateRows(prev.state) : [];
      stateRows(s.state).forEach(function (r) {
        var old = prevRows.filter(function (p) { return p[0] === r[0]; })[0];
        var changed = prev && (!old || old[1] !== r[1]);
        dl.appendChild(h('dt', { text: r[0] }));
        dl.appendChild(h('dd', { class: changed ? 'changed' : null, text: r[1] }));
      });
      dl.appendChild(h('dt', { text: 'actions run' }));
      dl.appendChild(h('dd', { text: s.executed.length ? s.executed.join(' | ') : 'none' }));
      statePanel.appendChild(dl);

      ctxPanel.textContent = '';
      ctxPanel.appendChild(h('p', { class: 'w-panel-title', text: 'Context for this call' }));
      if (s.context) {
        ctxPanel.appendChild(h('p', { class: 'al-ctx-total', text: '~' + fmt(s.counters.ctxTokens) + ' tokens sent' }));
        var ol = h('ol', { class: 'al-ctx-list' });
        s.context.forEach(function (b) {
          ol.appendChild(h('li', null,
            h('span', { class: 'w-pill ' + b.kind, text: PILL[b.kind] || b.kind }),
            h('span', { class: 'al-ctx-label', title: b.label, text: b.label }),
            h('span', { class: 'al-ctx-tok', text: fmt(b.tokens) })));
        });
        ctxPanel.appendChild(ol);
      } else {
        ctxPanel.appendChild(h('p', { class: 'al-idle', text: 'No inference is running. Task state stays in the runtime. On the next call the runtime rebuilds the context and sends all of it again.' }));
      }

      logPanel.textContent = '';
      logPanel.appendChild(h('p', { class: 'w-panel-title', text: 'Event log' }));
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
