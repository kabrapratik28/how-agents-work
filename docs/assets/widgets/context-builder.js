/* Context builder (chapter 04). Choose what goes into Patch's next model call, then see how full the window is,
   what the model can answer, what your code still keeps, and what the call costs.
   AC.sims['context-builder'].build(cfg) is pure and tested by tools/sims/context-builder.test.mjs.
   Token counts and prices are illustrative. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  var STEPS = 48;            // steps Patch has taken so far in this session
  var RECENT = 6;            // newest steps: outputs are never cleared, compaction keeps them word for word
  var RESERVE = 16000;       // tokens kept free for the reply
  var NEARLY_FULL = 0.8;     // illustrative compaction trigger, as a share of the space left for input
  var CALL_TOKENS = 120;     // one assistant message with a tool call
  var HOLDER_TOKENS = 30;    // one placeholder for a cleared output
  var OUTPUT_TOKENS = 1000;  // the reply to this call
  var PRICE = { cached: 0.1, uncached: 1, output: 4 };   // relative units per 1,000 tokens
  var WINDOWS = [32000, 128000, 200000, 1000000];
  var STEP = { failure: 1, staleRead: 3, constraint: 14, suite: 46 };

  var LATEST = 'Nice work. Make sure nothing else broke, write the PR summary, then deploy to staging.';
  var USER_MSGS = { 1: 20, 14: 30 };   // step: tokens. Step 14: "Don't edit anything in tests/fixtures/."

  // One entry per step: [tool, argument, output tokens]. Steps 15 to 42 are ordinary exploration.
  var SESSION = [
    ['run_command', 'make test', 6200], ['search_files', 'expires_at', 800], ['read_file', 'auth/session.py', 1700],
    ['read_file', 'auth/tokens.py', 2200], ['read_file', 'tests/test_auth.py', 2500], ['read_file', 'tests/fixtures/tokens.json', 2900],
    ['run_command', 'make test -k expired', 1400], ['edit_file', 'auth/tokens.py (clock-skew allowance)', 60],
    ['run_command', 'make test -k expired', 1400], ['edit_file', 'auth/tokens.py (revert)', 60],
    ['search_files', 'timedelta(minutes=10)', 600], ['read_file', 'auth/refresh.py', 2000], ['read_file', 'api/admin.py', 2400],
    ['read_file', 'docs/auth.md', 2800],
    ['read_file', 'auth/middleware.py', 2600], ['search_files', 'is_valid(', 700], ['read_file', 'tests/test_refresh.py', 3000],
    ['run_command', 'make test -k refresh', 1500], ['read_file', 'auth/models.py', 2300], ['search_files', 'grace', 600],
    ['read_file', 'config/settings.py', 2100], ['read_file', 'api/routes/login.py', 2400], ['run_command', 'git log --oneline -15 auth/', 900],
    ['read_file', 'docs/adr/007-token-expiry.md', 2900], ['search_files', 'expires_at >=', 500], ['read_file', 'tests/conftest.py', 2500],
    ['run_command', 'make test -k session', 1600], ['read_file', 'auth/clock.py', 1300], ['search_files', 'now()', 1000],
    ['read_file', 'tests/test_tokens.py', 2700], ['run_command', 'git blame auth/session.py', 1800], ['read_file', 'api/middleware/auth.py', 2500],
    ['read_file', 'auth/__init__.py', 700], ['search_files', 'timedelta', 900], ['read_file', 'tests/test_admin.py', 2800],
    ['run_command', 'make test -k admin', 1400], ['read_file', 'auth/errors.py', 1000], ['read_file', 'docs/runbooks/auth.md', 2600],
    ['search_files', 'test_login_expired_token', 400], ['read_file', 'tests/helpers/tokens.py', 2000], ['run_command', 'make lint', 1800],
    ['read_file', 'auth/refresh.py', 2100],
    ['read_file', 'auth/session.py', 1700], ['edit_file', 'auth/session.py: >= now - timedelta(minutes=10) becomes > now', 60],
    ['run_command', 'make test -k auth', 700], ['run_command', 'make test', 3200], ['edit_file', 'auth/session.py (docstring)', 60],
    ['run_command', 'git diff --stat', 150]
  ];

  var GROUPS = {
    rules: { label: 'Rules and tool list', role: 'runtime' },
    extras: { label: 'Skills, memory, helper report', role: 'state' },
    history: { label: 'History', role: 'model' },
    files: { label: 'Files', role: 'tool' },
    user: { label: "The user's message", role: 'user' }
  };
  var BLOCK = {
    system: { label: 'System prompt', group: 'rules', tokens: 1200 },
    tools: { group: 'rules', core: { label: 'Tool list: the 6 tools Patch uses', tokens: 2400 }, all: { label: 'Tool list: all 40 tools', tokens: 26000 } },
    agents: { label: 'Project notes (AGENTS.md)', group: 'rules', tokens: 1800 },
    skillsIndex: { label: 'Skills list: names and file paths', group: 'extras', tokens: 600 },
    memory: { label: 'Saved project facts (memory)', group: 'extras', tokens: 900 },
    subagent: { label: "Helper agent's report (it read 31,000 tokens to write it)", group: 'extras', tokens: 900 },
    relevant: { label: 'auth/session.py, the file being fixed', group: 'files', tokens: 1600 },
    dump: { label: 'Every file in auth/ and tests/', group: 'files', tokens: 64000 },
    skillBody: { label: 'Deploy steps (the deploy-staging skill)', group: 'extras', tokens: 2800 },
    user: { label: 'Latest user message', group: 'user', tokens: 60 }
  };

  var SUMMARY = {
    careful: {
      tokens: 1400,
      text: 'Goal: make tests/test_auth.py::test_login_expired_token pass.\n' +
        'User rule (step 14, word for word): "Don\'t edit anything in tests/fixtures/. The billing suite shares those files."\n' +
        'Original failure (step 1): assert 200 == 401. 1 failed, 211 passed.\n' +
        'Ruled out: a clock-skew allowance in auth/tokens.py (steps 8 to 10, reverted).\n' +
        'Finding: auth/session.py accepts tokens up to 10 minutes after expiry.\n' +
        'Full tool outputs: .patch/outputs/call_<n>.log'
    },
    careless: {
      tokens: 350,
      text: 'Patch looked into a failing auth test. It read many files, tried a change in auth/tokens.py ' +
        'that did not help, and narrowed the problem down to auth/session.py.'
    }
  };

  var CHANGE = {
    policy: { label: 'an edit to AGENTS.md', key: 'agents' },
    timestamp: { label: 'a timestamp at the top', key: 'system' },
    compaction: { label: 'compaction rewrote the history', key: null }
  };

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function outTokens(s) { return SESSION[s - 1][2]; }
  function userTokens(s) { return USER_MSGS[s] || 0; }
  function stepTokens(s) { return CALL_TOKENS + userTokens(s) + outTokens(s); }
  function range(a, b) { var out = []; for (var i = a; i <= b; i++) out.push(i); return out; }
  function total(list, fn) { return list.reduce(function (a, s) { return a + fn(s); }, 0); }
  function span(list) { return list.length === 1 ? 'Step ' + list[0] : 'Steps ' + list[0] + ' to ' + list[list.length - 1]; }
  var LOG_TOKENS = total(range(1, STEPS), stepTokens);

  function defaults() {
    return {
      window: 128000, system: true, agents: true, tools: 'core', skillsIndex: true, skillBody: false,
      memory: true, subagent: true, files: 'relevant', history: STEPS, cleared: false,
      compacted: false, summary: 'careful', change: 'policy'
    };
  }

  function normalize(cfg) {
    var c = defaults();
    Object.keys(c).forEach(function (k) { if (cfg && cfg[k] !== undefined) c[k] = cfg[k]; });
    c.history = Math.max(0, Math.min(STEPS, Math.round(Number(c.history) || 0)));
    c.window = WINDOWS.indexOf(Number(c.window)) === -1 ? 128000 : Number(c.window);
    if (c.tools !== 'all') c.tools = 'core';
    if (['none', 'relevant', 'dump'].indexOf(c.files) === -1) c.files = 'relevant';
    if (c.summary !== 'careless') c.summary = 'careful';
    if (!CHANGE[c.change]) c.change = 'policy';
    return c;
  }

  function block(key, label, group, tokens, extra) {
    var b = { key: key, label: label, group: group, role: GROUPS[group].role, tokens: tokens, fresh: false, history: false };
    if (extra) Object.keys(extra).forEach(function (k) { b[k] = extra[k]; });
    return b;
  }

  function build(input) {
    var c = normalize(input);
    var verbatim = c.compacted ? RECENT : c.history;
    var first = STEPS - verbatim + 1;                       // oldest step still sent word for word
    var inView = function (s) { return s >= first; };
    var placeholder = function (s) { return c.cleared && !c.compacted && inView(s) && s <= STEPS - RECENT; };
    var full = function (s) { return inView(s) && !placeholder(s); };
    var summarized = c.compacted ? STEPS - RECENT : 0;
    var dropped = c.compacted ? 0 : STEPS - verbatim;
    var sliding = !c.compacted && verbatim > 0 && verbatim < STEPS;  // the oldest sent step changes every call

    var blocks = [];
    if (c.system) blocks.push(block('system', BLOCK.system.label, 'rules', BLOCK.system.tokens));
    blocks.push(block('tools', BLOCK.tools[c.tools].label, 'rules', BLOCK.tools[c.tools].tokens));
    ['agents', 'skillsIndex', 'memory', 'subagent'].forEach(function (k) {
      if (c[k]) blocks.push(block(k, BLOCK[k].label, BLOCK[k].group, BLOCK[k].tokens));
    });
    if (c.compacted) {
      blocks.push(block('summary', 'Summary of steps 1 to ' + summarized + ' (' + c.summary + ')', 'history', SUMMARY[c.summary].tokens, { history: true }));
    }
    var steps = range(first, STEPS);
    var old = steps.filter(function (s) { return s <= STEPS - RECENT; });
    var recent = steps.filter(function (s) { return s > STEPS - RECENT && s < STEPS; });
    if (old.length) {
      var users = old.filter(function (s) { return USER_MSGS[s]; }).length;
      blocks.push(block('old-calls', span(old) + ': tool calls' + (users ? ' and ' + users + ' user message' + (users > 1 ? 's' : '') : ''), 'history',
        total(old, function (s) { return CALL_TOKENS + userTokens(s); }), { history: true }));
      blocks.push(c.cleared
        ? block('old-outputs', span(old) + ': ' + old.length + ' short placeholders for old tool outputs', 'history', old.length * HOLDER_TOKENS, { history: true })
        : block('old-outputs', span(old) + ': tool outputs', 'history', total(old, outTokens), { history: true }));
    }
    if (recent.length) blocks.push(block('recent', span(recent) + ': calls and outputs', 'history', total(recent, stepTokens), { history: true }));
    if (inView(STEPS)) blocks.push(block('newest', 'Step ' + STEPS + ': the newest call and output', 'history', stepTokens(STEPS), { history: true, fresh: true }));
    if (c.files !== 'none') blocks.push(block(c.files, BLOCK[c.files].label, 'files', BLOCK[c.files].tokens, { fresh: true }));
    if (c.skillBody) blocks.push(block('skillBody', BLOCK.skillBody.label, 'extras', BLOCK.skillBody.tokens, { fresh: true }));
    blocks.push(block('user', BLOCK.user.label, 'user', BLOCK.user.tokens, { fresh: true }));

    var occupancy = blocks.reduce(function (a, b) { return a + b.tokens; }, 0);
    var usable = c.window - RESERVE;
    var pct = occupancy / usable;
    var fits = occupancy <= usable;

    var pairs = steps.map(function (s) {
      var ph = placeholder(s);
      return { id: 'call_' + s, step: s, result: ph ? 'placeholder' : 'full', ref: ph ? '.patch/outputs/call_' + s + '.log' : null };
    });

    // Evidence rules: "in" when a sent block holds the fact; "tool" when a tool can fetch it and something sent
    // points to it (a path, a skills list entry, or a test run that has not happened yet); otherwise "missing".
    var probes = [];
    var p = function (key, q, state, why, stale) { probes.push({ key: key, q: q, state: state, why: why, stale: stale || null }); };
    var careful = c.compacted && c.summary === 'careful';

    var cq = 'If a billing test fails, may Patch edit tests/fixtures/tokens.json?';
    if (inView(STEP.constraint)) p('constraint', cq, 'in', 'No. The user said so at step 14, and that message is still sent.');
    else if (careful) p('constraint', cq, 'in', "No. The careful summary quotes the user's rule word for word.");
    else if (c.compacted) p('constraint', cq, 'missing', 'The careless summary dropped the rule. The session log still has it, but the model cannot see the log.');
    else p('constraint', cq, 'missing', 'Step 14 is no longer sent, and no summary covers it. Only the session log has the rule now.');

    var fq = 'What was the original failure? The PR summary needs it.';
    if (full(STEP.failure)) p('failure', fq, 'in', "Step 1's test output is still sent.");
    else if (placeholder(STEP.failure)) p('failure', fq, 'tool', "Step 1's placeholder names the saved file, so one read_file call brings it back.");
    else if (careful) p('failure', fq, 'in', 'The careful summary quotes the failing test.');
    else if (c.compacted) p('failure', fq, 'missing', 'The careless summary says only "a failing auth test", and nothing points to the details.');
    else p('failure', fq, 'missing', 'Step 1 is no longer sent, and no summary covers it.');

    p('suite', 'Does the full test suite pass with the latest edit?', 'tool',
      'No test has run since the edit at step 47, so only a new test run can answer.',
      full(STEP.suite) ? 'The passing run from step 46 is still in view, but it happened before the last edit, so it proves nothing.' : null);

    var lq = 'Does this fix need a changelog entry?';
    if (c.agents) p('changelog', lq, 'in', 'Yes. AGENTS.md says every fix needs a line in CHANGELOG.md.');
    else p('changelog', lq, 'missing', 'That rule is only in AGENTS.md, which is not sent, and nothing tells the model to look.');

    var dq = 'What are the steps to deploy to staging?';
    if (c.skillBody) p('deploy', dq, 'in', 'The deploy steps are loaded.');
    else if (c.skillsIndex) p('deploy', dq, 'tool', 'The skills list names the deploy skill and its file, so one read_file call loads the steps.');
    else p('deploy', dq, 'missing', 'With no skills list, nothing tells the model that the steps exist.');

    var kq = 'What calls is_valid(), across the whole repo?';
    if (c.subagent) p('callers', kq, 'in', "The helper agent searched the whole repo, and its report lists every caller.");
    else p('callers', kq, 'tool', 'A search_files call can find them.');

    var warnings = [];
    var w = function (key, text) { warnings.push({ key: key, text: text }); };
    if (!fits) w('overflow', 'Too big for the window, so the provider would reject the call.');
    else if (pct >= NEARLY_FULL) w('nearly-full', 'Over 80% full. A runtime like this one would compact now.');
    if (c.tools === 'all') w('tools', 'The tool list alone is ' + Math.round(100 * BLOCK.tools.all.tokens / occupancy) + '% of the context, and most of those tools are not needed here.');
    if (c.files === 'dump') w('dump', 'The folder dump is mostly noise, and it includes tests/fixtures/, which the user said not to edit.');
    if (full(STEP.staleRead)) w('stale-read', 'An old read of auth/session.py from before the fix is still in view.');
    if (!c.system) w('no-system', 'No system prompt, so the model gets no role, rules, or answer format.');
    if (!c.compacted && verbatim === 0) w('no-history', 'No history, so the model does not know what it has already done.');

    // Narration: the one consequence that matters most for the current choices. Warnings it already states are
    // listed in `covered`, so the widget does not show them twice.
    var say;
    var covered = [];
    if (!fits) {
      say = 'This does not fit. The input needs ' + fmt(occupancy) + ' tokens, but only ' + fmt(usable) + ' are left after the space kept for the reply, so something has to come out.';
      covered = ['overflow'];
    } else if (c.compacted && c.summary === 'careless') {
      say = "Compacting freed most of the window, but the careless summary dropped the user's rule about tests/fixtures/. The rule is still in the session log, where the model cannot see it.";
    } else if (c.compacted) {
      say = "Compacting freed most of the window. The careful summary kept the user's rule, and the full history is still in the session log.";
    } else if (c.cleared) {
      say = 'Old tool outputs are now short placeholders that say where the full text is saved. Every tool call still has its result, and most of the window is free again.';
    } else if (c.files === 'dump') {
      say = 'The whole folder fits in this window, but most of it is noise, and every call pays for it.';
      covered = ['dump'];
    } else if (c.tools === 'all') {
      say = 'All 40 tool definitions fit in this window, but most of them have nothing to do with this task.';
      covered = ['tools'];
    } else if (verbatim === 0) {
      say = 'No history is sent, so the model does not know what it has already done.';
      covered = ['no-history'];
    } else if (sliding) {
      say = 'Only the last ' + verbatim + ' steps are sent.' + (inView(STEP.constraint) ? '' : " The user's rule from step 14 is no longer in view.") +
        ' Because the oldest step changes on every call, the provider cannot reuse the history from its cache.';
    } else if (pct >= NEARLY_FULL) {
      say = 'Everything is in, and it fits, but the window is ' + Math.round(100 * pct) + '% full. A runtime like this one would compact now.';
      covered = ['nearly-full'];
      if (full(STEP.staleRead)) {
        say += ' An old read of auth/session.py from before the fix is also still in view.';
        covered.push('stale-read');
      }
    } else {
      say = 'This context fits, with room to spare.';
    }

    // Cost: the same input, priced three ways. The provider reuses only an identical prefix from an earlier call.
    function prefixBefore(stop) {
      var t = 0;
      for (var i = 0; i < blocks.length; i++) { if (stop(blocks[i])) break; t += blocks[i].tokens; }
      return t;
    }
    var unstable = function (b) { return b.fresh || (sliding && b.history); };
    var warmCached = prefixBefore(unstable);
    var ch = CHANGE[c.change];
    var changedSent = ch.key ? blocks.some(function (b) { return b.key === ch.key; }) : blocks.some(function (b) { return b.history; });
    var changedCached = changedSent
      ? Math.min(warmCached, prefixBefore(function (b) { return unstable(b) || (ch.key ? b.key === ch.key : b.history); }))
      : warmCached;
    function price(cached) {
      var uncached = occupancy - cached;
      return {
        cached: cached, uncached: uncached, output: OUTPUT_TOKENS,
        units: Math.round(cached * PRICE.cached + uncached * PRICE.uncached + OUTPUT_TOKENS * PRICE.output) / 1000
      };
    }

    return {
      cfg: c, blocks: blocks, occupancy: occupancy, window: c.window, reserve: RESERVE, usable: usable, pct: pct, fits: fits,
      history: { verbatim: verbatim, summarized: summarized, dropped: dropped, placeholders: pairs.filter(function (x) { return x.result === 'placeholder'; }).length, sliding: sliding },
      pairs: pairs,
      log: { steps: STEPS, userMessages: Object.keys(USER_MSGS).length, tokens: LOG_TOKENS, compactions: c.compacted ? 1 : 0 },
      summaryText: c.compacted ? SUMMARY[c.summary].text : null,
      probes: probes, warnings: warnings, say: say, covered: covered,
      cost: { output: OUTPUT_TOKENS, cold: price(0), warm: price(warmCached), changed: price(changedCached), changeLabel: ch.label, changeSent: changedSent }
    };
  }

  AC.sims['context-builder'] = { STEPS: STEPS, RECENT: RECENT, RESERVE: RESERVE, NEARLY_FULL: NEARLY_FULL, defaults: defaults, build: build };

  /* ---------- widget ---------- */

  var VERDICT = {
    in: { text: 'In view', cls: 'ok' },
    tool: { text: 'One tool call away', cls: 'mid' },
    missing: { text: 'Missing', cls: 'bad' }
  };
  function windowLabel(n) { return n >= 1000000 ? (n / 1000000) + 'M tokens' : (n / 1000) + 'K tokens'; }

  AC.widgets['context-builder'] = function (root) {
    var h = AC.h;
    var cfg = defaults();
    var controls = {};

    function toggle(key, label) {
      var id = AC.uid('cb-' + key);
      var input = h('input', { type: 'checkbox', id: id });
      input.addEventListener('change', function () { cfg[key] = input.checked; update(); });
      controls[key] = input;
      return h('label', { class: 'w-toggle', for: id }, input, h('span', { text: label }));
    }
    function choice(key, label, options) {
      var id = AC.uid('cb-' + key);
      var sel = h('select', { id: id });
      options.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
      sel.addEventListener('change', function () { cfg[key] = sel.value; update(); });
      controls[key] = sel;
      return h('span', { class: 'cb-choice' }, h('label', { for: id, text: label }), sel);
    }
    function group(title, kids) { return h('fieldset', { class: 'cb-group' }, h('legend', { text: title }), kids); }

    var frame = h('div', { class: 'w-frame cb' });
    frame.appendChild(h('div', { class: 'w-head' },
      h('p', { class: 'w-title', text: root.getAttribute('data-title') || "What goes into Patch's next call" }),
      h('p', { class: 'w-sub', text: 'Numbers are illustrative.' })));
    var body = h('div', { class: 'w-body' });
    frame.appendChild(body);
    body.appendChild(h('p', { class: 'cb-scene', text: 'Patch has taken 48 steps on a bug fix, and the user now writes:' }));
    body.appendChild(h('p', { class: 'cb-request' }, h('span', { class: 'badge user', text: 'User' }), LATEST));

    /* the main picture: how full the window is, and what that means */
    var big = h('p', { class: 'cb-big' });
    var bigSub = h('p', { class: 'cb-bigsub' });
    var barWrap = h('div', { class: 'cb-barwrap', 'aria-hidden': 'true' });
    var legend = h('ul', { class: 'cb-legend' });
    var say = h('p', { class: 'cb-say', 'aria-live': 'polite' });
    var warns = h('ul', { class: 'cb-warns' });
    var keeps = h('p', { class: 'cb-keeps' });
    var clearBtn = h('button', { class: 'w-btn', type: 'button', 'aria-pressed': 'false' });
    clearBtn.addEventListener('click', function () { cfg.cleared = !cfg.cleared; update(); });
    var compactBtn = h('button', { class: 'w-btn', type: 'button', 'aria-pressed': 'false' });
    compactBtn.addEventListener('click', function () { cfg.compacted = !cfg.compacted; update(); });
    var resetBtn = h('button', { class: 'w-btn', type: 'button', text: 'Start over' });
    resetBtn.addEventListener('click', function () { cfg = defaults(); update(); });
    var winChoice = choice('window', 'Window size', WINDOWS.map(function (n) { return [String(n), windowLabel(n)]; }));
    body.appendChild(h('div', { class: 'cb-picture' },
      h('div', { class: 'cb-picture-head' }, h('div', null, big, bigSub), winChoice),
      barWrap, legend, say, warns,
      h('div', { class: 'cb-actions' }, clearBtn, compactBtn,
        choice('summary', 'Summary', [['careful', 'careful'], ['careless', 'careless']]), resetBtn),
      keeps));

    /* choices and questions */
    var histId = AC.uid('cb-history');
    var histLabel = h('label', { for: histId });
    var slider = h('input', { type: 'range', id: histId, min: '0', max: String(STEPS), step: '1', class: 'cb-range' });
    slider.addEventListener('input', function () { cfg.history = Number(slider.value); update(); });
    var userId = AC.uid('cb-user');
    var ctl = h('div', { class: 'cb-panel cb-controls' },
      h('p', { class: 'cb-panel-title', text: 'Choose what goes in' }),
      group('Rules and tools', [toggle('system', 'System prompt'), toggle('agents', 'Project notes (AGENTS.md)'),
        choice('tools', 'Tool list', [['core', 'the 6 tools Patch uses'], ['all', 'all 40 tools']])]),
      group('Skills, memory, helpers', [toggle('skillsIndex', 'Skills list'), toggle('skillBody', 'Deploy steps (a skill)'),
        toggle('memory', 'Saved project facts (memory)'), toggle('subagent', "Helper agent's report")]),
      group('Files', choice('files', 'File', [['none', 'none'], ['relevant', 'the file being fixed'], ['dump', 'every file in auth/ and tests/']])),
      group('History', [h('span', { class: 'cb-choice cb-stack' }, histLabel, slider),
        h('label', { class: 'w-toggle', for: userId }, h('input', { type: 'checkbox', id: userId, checked: true, disabled: true }),
          h('span', { text: 'Latest user message (always sent)' }))]));
    var probeList = h('ul', { class: 'cb-probes' });
    var probes = h('div', { class: 'cb-panel' },
      h('p', { class: 'cb-panel-title', text: 'Can the model answer these now?' }),
      h('p', { class: 'cb-note', text: 'In view: the answer is in the context. One tool call away: a tool can fetch it, and something in the context points to it. Missing: neither.' }),
      probeList,
      h('p', { class: 'cb-note', text: 'Being in view does not guarantee that the model uses a fact well. Missing guarantees that it cannot.' }));
    body.appendChild(h('div', { class: 'cb-grid' }, ctl, probes));

    /* cost: secondary. Rows are built once, so the select inside the last row keeps focus. */
    var costRows = h('div', { class: 'cb-cost' });
    var costNotes = h('div');
    function costRow(labelEl) {
      var explain = h('span', { class: 'cb-cost-explain' });
      var reused = h('span', { class: 'cb-reused' });
      var fresh = h('span', { class: 'cb-new' });
      var reply = h('span', { class: 'cb-reply' });
      var mini = h('span', { class: 'cb-mini', 'aria-hidden': 'true' }, reused, fresh, reply);
      var units = h('span', { class: 'cb-units' });
      costRows.appendChild(h('div', { class: 'cb-cost-row' },
        h('div', { class: 'cb-cost-label' }, labelEl, explain), h('span', { class: 'cb-mini-track' }, mini), units));
      return function (x, top, text) {
        var part = function (n, price) { return (100 * n * price / 1000 / x.units) + '%'; };
        explain.textContent = text;
        mini.style.width = (100 * x.units / top) + '%';
        reused.style.width = part(x.cached, PRICE.cached);
        fresh.style.width = part(x.uncached, PRICE.uncached);
        reply.style.width = part(x.output, PRICE.output);
        units.textContent = Math.round(x.units) + ' units';
      };
    }
    var paintCold = costRow(h('span', { class: 'cb-cost-name', text: 'First call of a session' }));
    var paintWarm = costRow(h('span', { class: 'cb-cost-name', text: 'Next call' }));
    var paintChanged = costRow(choice('change', 'After', Object.keys(CHANGE).map(function (k) { return [k, CHANGE[k].label]; })));
    body.appendChild(h('div', { class: 'cb-panel cb-cost-panel' },
      h('p', { class: 'cb-panel-title', text: 'What this call costs' }), costRows, costNotes));

    /* every block: tucked away */
    var blockList = h('ol', { class: 'cb-list' });
    var summaryBox = h('div');
    body.appendChild(h('details', { class: 'cb-more' }, h('summary', { text: 'Show every block that is sent, in order' }), blockList, summaryBox));

    function sync(r) {
      ['system', 'agents', 'skillsIndex', 'skillBody', 'memory', 'subagent'].forEach(function (k) { controls[k].checked = !!cfg[k]; });
      ['tools', 'files', 'summary', 'change'].forEach(function (k) { controls[k].value = cfg[k]; });
      controls.window.value = String(cfg.window);
      slider.value = String(r.history.verbatim);
      slider.disabled = cfg.compacted;
      slider.setAttribute('aria-valuetext', r.history.verbatim + ' steps');
      histLabel.textContent = cfg.compacted ? 'Compacted: a summary plus the last ' + RECENT + ' steps' : 'Steps sent: the last ' + r.history.verbatim + ' of ' + STEPS;
      clearBtn.textContent = cfg.cleared ? 'Bring back old outputs' : 'Clear old tool outputs';
      clearBtn.setAttribute('aria-pressed', String(!!cfg.cleared));
      clearBtn.disabled = cfg.compacted;
      compactBtn.textContent = cfg.compacted ? 'Undo compaction' : 'Compact the history';
      compactBtn.setAttribute('aria-pressed', String(!!cfg.compacted));
      controls.summary.disabled = !cfg.compacted;
    }

    function paintPicture(r) {
      var pc = Math.round(100 * r.pct);
      big.textContent = r.fits ? pc + '% full' : 'Too big: ' + pc + '%';
      big.classList.toggle('over', !r.fits);
      bigSub.textContent = r.fits
        ? fmt(r.occupancy) + ' tokens used, out of ' + fmt(r.usable) + ' available for input (the rest is kept free for the reply)'
        : fmt(r.occupancy) + ' tokens needed, but only ' + fmt(r.usable) + ' are available for input';
      var whole = Math.max(r.window, r.occupancy + r.reserve);
      var width = function (n) { return (100 * n / whole) + '%'; };
      barWrap.textContent = '';
      var bar = h('div', { class: 'cb-bar' });
      r.blocks.forEach(function (b) { bar.appendChild(h('span', { class: 'cb-seg ' + b.role, title: b.label + ': ' + fmt(b.tokens) + ' tokens', style: { width: width(b.tokens) } })); });
      if (r.fits) bar.appendChild(h('span', { class: 'cb-free', style: { width: width(r.usable - r.occupancy) } }));
      bar.appendChild(h('span', { class: 'cb-reserve', style: { width: width(r.reserve) } }));
      barWrap.appendChild(bar);
      if (!r.fits) {
        barWrap.appendChild(h('span', { class: 'cb-over', style: { left: width(r.window), width: width(whole - r.window) } }));
        barWrap.appendChild(h('span', { class: 'cb-limit', style: { left: width(r.window) } }));
      }
      legend.textContent = '';
      Object.keys(GROUPS).forEach(function (g) {
        if (!r.blocks.some(function (b) { return b.group === g; })) return;
        legend.appendChild(h('li', null, h('span', { class: 'cb-swatch ' + GROUPS[g].role }), GROUPS[g].label));
      });
      legend.appendChild(h('li', null, h('span', { class: 'cb-swatch cb-hatch' }), 'Kept free for the reply'));
      if (!r.fits) legend.appendChild(h('li', null, h('span', { class: 'cb-swatch cb-overflow' }), 'Past the window limit'));
      say.textContent = r.say;
      warns.textContent = '';
      r.warnings.forEach(function (x) {
        if (r.covered.indexOf(x.key) === -1) warns.appendChild(h('li', { text: x.text }));
      });
      keeps.textContent = 'Your code still keeps all ' + r.log.steps + ' steps and every full tool output in its session log' +
        (r.log.compactions ? ', plus the summary as a new entry' : '') + '. The model sees only what is in the bar.';
    }

    function paintProbes(r) {
      probeList.textContent = '';
      r.probes.forEach(function (p) {
        probeList.appendChild(h('li', null,
          h('p', { class: 'cb-q', text: p.q }),
          h('p', { class: 'cb-answer' }, h('span', { class: 'cb-verdict ' + VERDICT[p.state].cls, text: VERDICT[p.state].text }), ' ', p.why),
          p.stale ? h('p', { class: 'cb-stale', text: p.stale }) : null));
      });
    }

    function paintCost(r) {
      var top = Math.max(r.cost.cold.units, r.cost.warm.units, r.cost.changed.units);
      paintCold(r.cost.cold, top, 'Nothing can be reused yet.');
      paintWarm(r.cost.warm, top, 'The same start is reused.');
      paintChanged(r.cost.changed, top, r.cost.changeSent ? 'Reuse stops at the change.' : 'That part is not sent, so nothing changes.');
      costNotes.textContent = '';
      costNotes.appendChild(h('ul', { class: 'cb-legend' },
        h('li', null, h('span', { class: 'cb-swatch cb-reused' }), 'input reused from the cache'),
        h('li', null, h('span', { class: 'cb-swatch cb-new' }), 'new input'),
        h('li', null, h('span', { class: 'cb-swatch cb-reply' }), 'the reply')));
      if (!r.fits) costNotes.appendChild(h('p', { class: 'cb-note cb-strong', text: 'This context does not fit, so the provider would reject all three calls. Caching cannot make room.' }));
      costNotes.appendChild(h('p', { class: 'cb-note', text: 'All three calls send the same ' + fmt(r.occupancy) + ' tokens, so the window is equally full. Reuse only lowers the price and the wait.' }));
      if (r.history.sliding) costNotes.appendChild(h('p', { class: 'cb-note', text: 'Here the oldest sent step changes on every call, so reuse stops where the history starts.' }));
      costNotes.appendChild(h('p', { class: 'cb-note', text: 'Prices: reused input 0.1, new input 1, reply 4 units per 1,000 tokens. Real reuse also depends on provider rules, such as a minimum length and how long the cache is kept.' }));
    }

    function paintBlocks(r) {
      blockList.textContent = '';
      var boundary = false;
      r.blocks.forEach(function (b, i) {
        if (!boundary && (b.fresh || (r.history.sliding && b.history))) {
          boundary = true;
          blockList.appendChild(h('li', { class: 'cb-boundary' }, 'A cached call reuses everything above this line.'));
        }
        if (b.history && i > 0 && !r.blocks[i - 1].history && r.history.dropped) {
          blockList.appendChild(h('li', { class: 'cb-muted' }, 'Steps 1 to ' + r.history.dropped + ' are not sent. They stay in the session log.'));
        }
        blockList.appendChild(h('li', null, h('span', { class: 'cb-swatch ' + b.role }),
          h('span', { class: 'cb-label', text: b.label }), h('span', { class: 'cb-num', text: fmt(b.tokens) + ' tokens' })));
      });
      summaryBox.textContent = '';
      if (r.summaryText) {
        summaryBox.appendChild(h('p', { class: 'cb-panel-title', text: 'The summary the model will read' }));
        summaryBox.appendChild(h('pre', { class: 'cb-summary', text: r.summaryText }));
      }
    }

    function update() {
      var r = build(cfg);
      cfg = r.cfg;
      sync(r);
      paintPicture(r);
      paintProbes(r);
      paintCost(r);
      paintBlocks(r);
    }

    root.appendChild(frame);
    update();
  };
})();
