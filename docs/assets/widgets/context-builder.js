/* Context builder (chapter 04). Toggle what goes into Patch's next model call and watch what the model sees
   and what it can answer. Compaction, extra options, cost, and the session log sit in sections below.
   AC.sims['context-builder'] (build, describe) is pure and tested by tools/sims/context-builder.test.mjs.
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
    extras: { label: 'Memory, skills, helper report', role: 'state' },
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

  // Plain names for the probes, used when the narration reports which answers changed.
  var TOPIC = {
    constraint: "the user's rule about tests/fixtures/", failure: 'the original failure', suite: 'whether the suite passes',
    changelog: 'the changelog rule', deploy: 'the deploy steps', callers: 'the callers of is_valid()'
  };
  var STATE_WORD = { in: 'in view', tool: 'one tool call away', missing: 'missing' };
  var NO_TOOL_WHY = {
    failure: "Step 1's placeholder names the saved file, but no tools are sent, so the model cannot read it.",
    suite: 'No test has run since the edit at step 47, and no tools are sent, so the model cannot run one.',
    deploy: 'The skills list names the deploy skill, but no tools are sent, so the model cannot read it.',
    callers: 'There is no helper report, and no tools are sent, so the model cannot search.'
  };

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function outTokens(s) { return SESSION[s - 1][2]; }
  function userTokens(s) { return USER_MSGS[s] || 0; }
  function stepTokens(s) { return CALL_TOKENS + userTokens(s) + outTokens(s); }
  function range(a, b) { var out = []; for (var i = a; i <= b; i++) out.push(i); return out; }
  function total(list, fn) { return list.reduce(function (a, s) { return a + fn(s); }, 0); }
  function span(list) { return list.length === 1 ? 'Step ' + list[0] : 'Steps ' + list[0] + ' to ' + list[list.length - 1]; }
  function windowLabel(n) { return n >= 1000000 ? (n / 1000000) + 'M tokens' : (n / 1000) + 'K tokens'; }
  function joinAnd(parts) { return parts.length < 3 ? parts.join(' and ') : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1]; }
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
    if (['none', 'core', 'all'].indexOf(c.tools) === -1) c.tools = 'core';
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
    if (c.tools !== 'none') blocks.push(block('tools', BLOCK.tools[c.tools].label, 'rules', BLOCK.tools[c.tools].tokens));
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

    // Evidence rules: "in" when a sent block holds the fact; "tool" when a sent tool can fetch it and something sent
    // points to it (a path, a skills list entry, or a test run that has not happened yet); otherwise "missing".
    // With no tool list, no tool can be called, so "tool" turns into "missing".
    var probes = [];
    var noTools = c.tools === 'none';
    var p = function (key, q, state, why, stale) {
      if (noTools && state === 'tool') { state = 'missing'; why = NO_TOOL_WHY[key]; }
      probes.push({ key: key, q: q, state: state, why: why, stale: stale || null });
    };
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
    if (noTools) w('no-tools', 'No tool list, so the model cannot read files, run tests, or search.');
    if (c.files === 'dump') w('dump', 'The folder dump is mostly noise, and it includes tests/fixtures/, which the user said not to edit.');
    if (full(STEP.staleRead)) w('stale-read', 'An old read of auth/session.py from before the fix is still in view.');
    if (!c.system) w('no-system', 'No system prompt, so the model gets no role, rules, or answer format.');
    if (!c.compacted && verbatim === 0) w('no-history', 'No history, so the model does not know what it has already done.');

    // Narration of the current state, shown before the reader changes anything. Warnings it already states are
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
    } else if (noTools) {
      say = 'No tools are sent, so the model can answer only from what it sees.';
      covered = ['no-tools'];
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

  // One or two plain sentences about what the last change did: the change, the size effect, and changed answers.
  function describe(prev, next) {
    var a = prev.cfg, b = next.cfg;
    var onOff = function (key, thing) { return (b[key] ? 'You added ' : 'You removed ') + thing + '.'; };
    var what = [];
    if (a.system !== b.system) what.push(onOff('system', 'the system prompt'));
    if (a.agents !== b.agents) what.push(onOff('agents', 'the project notes (AGENTS.md)'));
    if (a.memory !== b.memory) what.push(onOff('memory', 'the saved project facts'));
    if (a.skillsIndex !== b.skillsIndex) what.push(onOff('skillsIndex', 'the skills list'));
    if (a.subagent !== b.subagent) what.push(onOff('subagent', "the helper agent's report"));
    if (a.skillBody !== b.skillBody) what.push(b.skillBody ? 'You loaded the full deploy steps.' : 'You removed the full deploy steps.');
    if (a.tools !== b.tools) what.push({ none: 'You removed the tool list.', core: 'You sent the 6 tools Patch uses.', all: 'You sent all 40 tools.' }[b.tools]);
    if (a.files !== b.files) what.push({ none: 'You removed the file.', relevant: 'You sent only the file being fixed.', dump: 'You sent every file in auth/ and tests/.' }[b.files]);
    if (a.window !== b.window) what.push('You switched to a ' + windowLabel(b.window) + ' window.');
    if (!b.compacted && a.history !== b.history) what.push(b.history === STEPS ? 'You now send all ' + STEPS + ' steps.' : 'You now send only the last ' + b.history + ' steps.');
    if (a.compacted !== b.compacted) what.push(b.compacted ? 'You compacted the history with a ' + b.summary + ' summary.' : 'You undid the compaction.');
    else if (b.compacted && a.summary !== b.summary) what.push('You switched to a ' + b.summary + ' summary.');
    if (!b.compacted && a.cleared !== b.cleared) what.push(b.cleared ? 'You cleared the old tool outputs.' : 'You brought back the old tool outputs.');
    if (!what.length && a.change !== b.change) return 'The cost section now prices a call after ' + CHANGE[b.change].label + '.';
    if (!what.length) return next.say;

    var delta = next.occupancy - prev.occupancy;
    var size = delta === 0 ? ' The size did not change.'
      : ' The context ' + (delta > 0 ? 'grew' : 'shrank') + ' by ' + fmt(Math.abs(delta)) + ' tokens' +
        (next.fits ? ' and is now ' + Math.round(100 * next.pct) + '% full.' : ', and now it does not fit, so the provider would reject the call.');
    if (next.fits && !prev.fits) size += ' It fits again.';

    var changed = next.probes.filter(function (q, i) { return q.state !== prev.probes[i].state; });
    var answers = '';
    ['missing', 'tool', 'in'].forEach(function (state) {
      var topics = changed.filter(function (q) { return q.state === state; }).map(function (q) { return TOPIC[q.key]; });
      if (topics.length) answers += ' Now ' + STATE_WORD[state] + ': ' + joinAnd(topics) + '.';
    });
    return what.join(' ') + size + (answers || ' Every answer stays the same.');
  }

  AC.sims['context-builder'] = { STEPS: STEPS, RECENT: RECENT, RESERVE: RESERVE, NEARLY_FULL: NEARLY_FULL, defaults: defaults, build: build, describe: describe };

  /* ---------- widget ---------- */

  var VERDICT = {
    in: { text: 'In view', cls: 'ok' },
    tool: { text: 'One tool call away', cls: 'mid' },
    missing: { text: 'Missing', cls: 'bad' }
  };

  AC.widgets['context-builder'] = function (root) {
    var h = AC.h;
    var cfg = defaults();
    var last = null;          // the previous result, so the narration can say what changed
    var syncs = [];           // functions that copy cfg into the controls after each change

    function check(label, hint, isOn, setOn) {
      var id = AC.uid('cb');
      var input = h('input', { type: 'checkbox', id: id });
      var hintEl = h('span', { class: 'cb-hint' });
      input.addEventListener('change', function () { setOn(input.checked); update(); });
      syncs.push(function () {
        input.checked = isOn();
        hintEl.textContent = typeof hint === 'function' ? hint() : hint;
      });
      return h('label', { class: 'w-toggle cb-check', for: id }, input, h('span', null, h('span', { class: 'cb-name', text: label }), hintEl));
    }
    function choice(label, options, get, set) {
      var id = AC.uid('cb');
      var sel = h('select', { id: id });
      options.forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
      sel.addEventListener('change', function () { set(sel.value); update(); });
      syncs.push(function () { sel.value = String(get()); });
      return { el: h('span', { class: 'cb-choice' }, h('label', { for: id, text: label }), sel), sel: sel };
    }
    function more(title, kids) {
      return h('details', { class: 'cb-more' }, h('summary', { text: title }), h('div', { class: 'cb-more-body' }, kids));
    }

    var frame = h('div', { class: 'w-frame cb' });
    frame.appendChild(h('div', { class: 'w-head' },
      h('p', { class: 'w-title', text: root.getAttribute('data-title') || "What the model sees on Patch's next call" }),
      h('p', { class: 'w-sub', text: 'Numbers are illustrative.' })));
    var body = h('div', { class: 'w-body' });
    frame.appendChild(body);
    body.appendChild(h('p', { class: 'cb-scene', text: 'Patch has taken 48 steps on a bug fix, and the user now writes:' }));
    body.appendChild(h('p', { class: 'cb-request' }, h('span', { class: 'badge user', text: 'User' }), LATEST));

    /* first screen: what the model sees */
    var big = h('p', { class: 'cb-big' });
    var bigSub = h('p', { class: 'cb-bigsub' });
    var barWrap = h('div', { class: 'cb-barwrap', 'aria-hidden': 'true' });
    var legend = h('ul', { class: 'cb-legend' });
    var say = h('p', { class: 'cb-say', 'aria-live': 'polite' });
    var warns = h('ul', { class: 'cb-warns' });
    body.appendChild(h('div', { class: 'cb-picture' },
      h('p', { class: 'cb-panel-title', text: 'What the model sees' }), big, bigSub, barWrap, legend, say, warns));

    /* first screen: the seven toggles and the questions */
    var histId = AC.uid('cb-history');
    var histLabel = h('label', { for: histId, class: 'cb-name' });
    var slider = h('input', { type: 'range', id: histId, min: '0', max: String(STEPS), step: '1', class: 'cb-range' });
    slider.addEventListener('input', function () { cfg.history = Number(slider.value); update(); });
    var resetBtn = h('button', { class: 'w-btn', type: 'button', text: 'Start over' });
    resetBtn.addEventListener('click', function () { cfg = defaults(); last = null; update(); });
    var toggles = h('div', { class: 'cb-panel cb-controls' },
      h('p', { class: 'cb-panel-title', text: 'Choose what the model sees' }),
      check('System prompt', 'your rules for the model', function () { return cfg.system; }, function (on) { cfg.system = on; }),
      h('div', { class: 'cb-slider' }, histLabel, slider),
      check('Tools', function () { return cfg.tools === 'all' ? 'all 40 tools (set under More options)' : 'the 6 tools Patch can use'; },
        function () { return cfg.tools !== 'none'; }, function (on) { cfg.tools = on ? 'core' : 'none'; }),
      check('Memory', '3 saved facts about the project', function () { return cfg.memory; }, function (on) { cfg.memory = on; }),
      check('Files', function () { return cfg.files === 'dump' ? 'every file in auth/ and tests/ (set under More options)' : 'auth/session.py, the file being fixed'; },
        function () { return cfg.files !== 'none'; }, function (on) { cfg.files = on ? 'relevant' : 'none'; }),
      check('Skills', 'a list of skills the model can load', function () { return cfg.skillsIndex; }, function (on) { cfg.skillsIndex = on; }),
      check('Subagent results', "the helper agent's report", function () { return cfg.subagent; }, function (on) { cfg.subagent = on; }),
      h('p', { class: 'cb-note', text: "The user's latest message is always sent." }),
      resetBtn);
    var probeList = h('ul', { class: 'cb-probes' });
    var probes = h('div', { class: 'cb-panel' },
      h('p', { class: 'cb-panel-title', text: 'What the model can answer right now' }),
      h('p', { class: 'cb-note', text: 'In view: the answer is in the context. One tool call away: a tool can fetch it, and something in the context points to it. Missing: neither.' }),
      probeList,
      h('p', { class: 'cb-note', text: 'Being in view does not guarantee that the model uses a fact well. Missing guarantees that it cannot.' }));
    body.appendChild(h('div', { class: 'cb-grid' }, toggles, probes));

    /* below the first screen: labeled sections, closed until the reader opens them */
    var clearBtn = h('button', { class: 'w-btn', type: 'button', 'aria-pressed': 'false' });
    clearBtn.addEventListener('click', function () { cfg.cleared = !cfg.cleared; update(); });
    var compactBtn = h('button', { class: 'w-btn', type: 'button', 'aria-pressed': 'false' });
    compactBtn.addEventListener('click', function () { cfg.compacted = !cfg.compacted; update(); });
    var summaryChoice = choice('Summary', [['careful', 'careful'], ['careless', 'careless']], function () { return cfg.summary; }, function (v) { cfg.summary = v; });
    body.appendChild(more('Try compaction: shrink the history when the window fills', [
      h('p', { class: 'cb-text', text: 'Clearing swaps old tool outputs for short placeholders that point to the saved full text. Compacting replaces the old steps with a summary and keeps the last 6 steps word for word.' }),
      h('div', { class: 'cb-actions' }, clearBtn, compactBtn, summaryChoice.el)]));

    body.appendChild(more('More options: window size, more tools, a folder dump, and more', [
      choice('Window size', WINDOWS.map(function (n) { return [String(n), windowLabel(n)]; }), function () { return cfg.window; }, function (v) { cfg.window = Number(v); }).el,
      check('Send all 40 tools', 'instead of the 6 Patch uses', function () { return cfg.tools === 'all'; }, function (on) { cfg.tools = on ? 'all' : 'core'; }),
      check('Send every file in auth/ and tests/', 'instead of only the file being fixed', function () { return cfg.files === 'dump'; }, function (on) { cfg.files = on ? 'dump' : 'relevant'; }),
      check('Load the full deploy steps', 'the text of one skill, not only its name', function () { return cfg.skillBody; }, function (on) { cfg.skillBody = on; }),
      check('Project notes (AGENTS.md)', "the team's rules, such as the changelog rule", function () { return cfg.agents; }, function (on) { cfg.agents = on; })]));

    // Cost rows are built once, so the select inside the last row keeps focus when it changes.
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
        var part = function (n, rate) { return (100 * n * rate / 1000 / x.units) + '%'; };
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
    var paintChanged = costRow(choice('After', Object.keys(CHANGE).map(function (k) { return [k, CHANGE[k].label]; }),
      function () { return cfg.change; }, function (v) { cfg.change = v; }).el);
    body.appendChild(more('What it costs: a first call, a cached call, and a call after a change', [costRows, costNotes]));

    var keeps = h('p', { class: 'cb-text' });
    var blockList = h('ol', { class: 'cb-list' });
    var summaryBox = h('div');
    body.appendChild(more('What your code keeps, and every block that is sent', [keeps, blockList, summaryBox]));

    function sync(r) {
      syncs.forEach(function (f) { f(); });
      slider.value = String(r.history.verbatim);
      slider.disabled = cfg.compacted;
      slider.setAttribute('aria-valuetext', r.history.verbatim + ' steps');
      histLabel.textContent = cfg.compacted ? 'History: compacted to a summary plus the last ' + RECENT + ' steps' : 'History: the last ' + r.history.verbatim + ' of ' + STEPS + ' steps';
      clearBtn.textContent = cfg.cleared ? 'Bring back old outputs' : 'Clear old tool outputs';
      clearBtn.setAttribute('aria-pressed', String(!!cfg.cleared));
      clearBtn.disabled = cfg.compacted;
      compactBtn.textContent = cfg.compacted ? 'Undo compaction' : 'Compact the history';
      compactBtn.setAttribute('aria-pressed', String(!!cfg.compacted));
      summaryChoice.sel.disabled = !cfg.compacted;
    }

    function paintPicture(r) {
      var pc = Math.round(100 * r.pct);
      big.textContent = r.fits ? pc + '% full' : 'Too big: ' + pc + '%';
      big.classList.toggle('over', !r.fits);
      bigSub.textContent = r.fits
        ? fmt(r.occupancy) + ' tokens used, out of ' + fmt(r.usable) + ' available for input (the rest of the ' + fmt(r.window) + '-token window is kept free for the reply)'
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
      say.textContent = last ? describe(last, r) : r.say;
      warns.textContent = '';
      r.warnings.forEach(function (x) {
        if (!last && r.covered.indexOf(x.key) !== -1) return;
        if (x.key === 'overflow') return;   // the headline already says it
        warns.appendChild(h('li', { text: x.text }));
      });
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

    function paintKeeps(r) {
      keeps.textContent = 'Your code keeps all ' + r.log.steps + ' steps (' + fmt(r.log.tokens) + ' tokens) and every full tool output in its session log' +
        (r.log.compactions ? ', plus the summary as a new entry' : '') + '. None of it reaches the model unless it is in the list below.';
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
        summaryBox.appendChild(h('p', { class: 'cb-name', text: 'The summary the model will read' }));
        summaryBox.appendChild(h('pre', { class: 'cb-summary', text: r.summaryText }));
      }
    }

    function update() {
      var r = build(cfg);
      cfg = Object.assign({}, r.cfg);   // a copy: r.cfg must stay as it was, so the next narration can compare
      sync(r);
      paintPicture(r);
      paintProbes(r);
      paintCost(r);
      paintKeeps(r);
      last = r;
    }

    root.appendChild(frame);
    update();
  };
})();
