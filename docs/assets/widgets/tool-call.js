/* The life of a tool call (chapter 02). Five cases: a valid call, a bad argument type, a policy denial,
   parallel calls, and a large output. AC.sims['tool-call'].build(key) runs a scenario script through a
   tiny runtime (schema check, policy check, dispatch over a fake workspace, output limit). It is pure and
   tested by tools/sims/tool-call.test.mjs. Times and sizes are illustrative. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  var ROOT = '/workspace';
  var OUT_DIR = '.patch/outputs/';
  var LIMIT = { maxLines: 40, head: 3, tail: 4 };
  var ALLOW_CMDS = ['pytest', 'git status', 'git diff'];

  var TOOLS = {
    search_files: {
      description: 'Search for literal text in files under the workspace. Returns matching lines as path:line: text.',
      effect: 'read-only',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to find, not a regex' },
          path: { type: 'string', description: 'File or folder. Default: the whole workspace' },
          max_results: { type: 'integer', minimum: 1, maximum: 50, default: 20 }
        },
        required: ['query'],
        additionalProperties: false
      }
    },
    read_file: {
      description: 'Read a text file inside the workspace.',
      effect: 'read-only',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative to the workspace root' },
          offset: { type: 'integer', minimum: 1, default: 1, description: 'First line to read' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100, description: 'How many lines to read' }
        },
        required: ['path'],
        additionalProperties: false
      }
    },
    run_command: {
      description: 'Run a shell command in the sandbox, from the workspace root. Returns the exit code and output.',
      effect: 'depends on the command',
      parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'], additionalProperties: false }
    }
  };

  // The fake workspace. /deploy/prod.env sits outside it; the policy must stop every read of it.
  var FILES = {
    'auth/models.py': 'class Token(Base):\n    expires_at = Column(DateTime, nullable=False)',
    'auth/session.py': 'from datetime import timedelta\n\ndef is_valid(token, now):\n    # grace period left over from an old mobile-client workaround\n    return token.expires_at >= now - timedelta(minutes=10)',
    'auth/token_utils.py': 'from config.settings import TOKEN_TTL_MINUTES\n\ndef new_token(user, now):\n    expires_at = now + timedelta(minutes=TOKEN_TTL_MINUTES)\n    return Token(user=user, expires_at=expires_at)',
    'config/settings.py': 'import os\n\nTOKEN_TTL_MINUTES = int(os.environ.get("TOKEN_TTL_MINUTES", "30"))',
    'tests/test_auth.py': 'def test_login_expired_token(client, token, now):\n    token.expires_at = now - timedelta(minutes=1)\n    assert client.get("/me", token=token).status_code == 401'
  };
  var OUTSIDE = { '/deploy/prod.env': 'SECRET_KEY=sk_live_51Hx9...\nTOKEN_TTL_MINUTES=15' };

  // A 1,200-test suite with two failures, as `pytest -v` would print it.
  var SUITE = (function () {
    var out = [];
    ['api', 'auth', 'billing', 'search', 'users', 'admin'].forEach(function (m) {
      for (var i = 1; i <= 200; i++) {
        var t = { name: 'tests/test_' + m + '.py::test_' + m + '_' + ('00' + i).slice(-3), outcome: 'passed' };
        if (m === 'auth' && i === 57) t = { name: 'tests/test_auth.py::test_login_expired_token', outcome: 'failed', message: 'assert 200 == 401' };
        if (m === 'billing' && i === 131) t = { name: 'tests/test_billing.py::test_refund_rounding', outcome: 'failed', message: "assert Decimal('9.99') == Decimal('10.00')" };
        out.push(t);
      }
    });
    return out;
  })();
  function failed(t) { return t.outcome === 'failed'; }

  var FAIL_HEADER = '____________________ test_login_expired_token ____________________';
  function suiteLog() {
    var bad = SUITE.filter(failed);
    var lines = ['============================= test session starts ==============================', 'collected ' + SUITE.length + ' items', ''];
    SUITE.forEach(function (t, n) {
      var pct = String(Math.floor(100 * (n + 1) / SUITE.length));
      var left = t.name + ' ' + t.outcome.toUpperCase();
      var right = '[' + '   '.slice(pct.length) + pct + '%]';
      lines.push(left + ' '.repeat(Math.max(1, 80 - left.length - right.length)) + right);
    });
    lines.push('', '=================================== FAILURES ===================================');
    lines.push(FAIL_HEADER, '',
      'client = <TestClient app=web>, token = <Token user=7 expires_at=09:59>', 'now = datetime(2026, 10, 19, 10, 0)', '',
      '>       assert client.get("/me", token=token).status_code == 401', 'E       assert 200 == 401', '',
      'tests/test_auth.py:3: AssertionError');
    lines.push('____________________ test_refund_rounding ____________________', '',
      "order = <Order id=88 total=Decimal('29.97')>", '',
      ">       assert refund(order, items=1) == Decimal('10.00')", "E       assert Decimal('9.99') == Decimal('10.00')", '',
      'tests/test_billing.py:212: AssertionError');
    lines.push('=========================== short test summary info ============================');
    bad.forEach(function (t) { lines.push('FAILED ' + t.name + ' - ' + t.message); });
    lines.push('================== ' + bad.length + ' failed, ' + (SUITE.length - bad.length) + ' passed in 48.31s ==================');
    return lines.join('\n');
  }
  var COMMANDS = { 'pytest -v': 'exit code 1\n' + suiteLog() };
  var LOG = COMMANDS['pytest -v'];
  var FAIL_LINE = LOG.split('\n').indexOf(FAIL_HEADER) + 1;

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function ms(n) { return n >= 1000 ? (n / 1000).toFixed(1) + ' s' : n + ' ms'; }

  /* ---------- the runtime: validate, policy, dispatch, limit ---------- */

  // A small JSON Schema subset: required, unknown fields, string, integer with a range.
  function validate(name, args) {
    var def = TOOLS[name];
    if (!def) return [{ field: 'name', message: 'unknown tool ' + name }];
    if (!args || typeof args !== 'object' || Array.isArray(args)) return [{ field: 'arguments', message: 'arguments must be a JSON object' }];
    var sch = def.parameters;
    var errs = [];
    sch.required.forEach(function (k) { if (!(k in args)) errs.push({ field: k, message: k + ' is required' }); });
    Object.keys(args).forEach(function (k) {
      var p = sch.properties[k];
      var v = args[k];
      if (!p) { errs.push({ field: k, message: 'unknown field ' + k }); return; }
      var hint = p.default != null ? ' Leave it out for the default (' + p.default + ').' : '';
      if (p.type === 'string' && typeof v !== 'string') errs.push({ field: k, message: k + ' must be a string (got ' + JSON.stringify(v) + ')' });
      if (p.type === 'integer' && !(typeof v === 'number' && v % 1 === 0 && !(v < p.minimum) && !(v > p.maximum))) {
        var range = p.maximum != null ? 'from ' + p.minimum + ' to ' + p.maximum : 'of at least ' + p.minimum;
        errs.push({ field: k, message: k + ' must be an integer ' + range + ' (got ' + JSON.stringify(v) + ').' + hint });
      }
    });
    return errs;
  }

  function resolvePath(p) {
    var out = [];
    (p.charAt(0) === '/' ? p : ROOT + '/' + p).split('/').forEach(function (part) {
      if (!part || part === '.') return;
      if (part === '..') out.pop(); else out.push(part);
    });
    return '/' + out.join('/');
  }
  function inside(abs) { return abs === ROOT || abs.indexOf(ROOT + '/') === 0; }

  function policy(name, args) {
    if (name === 'run_command') {
      var cmd = String(args.cmd);
      if (/[;&|`$<>\n]/.test(cmd)) return { allow: false, field: 'cmd', reason: 'shell operators are not allowed in ' + JSON.stringify(cmd) };
      var hit = ALLOW_CMDS.filter(function (a) { return cmd === a || cmd.indexOf(a + ' ') === 0; })[0];
      return hit ? { allow: true, reason: hit + ' is on the command allowlist' }
        : { allow: false, field: 'cmd', reason: JSON.stringify(cmd) + ' is not on the command allowlist (' + ALLOW_CMDS.join(', ') + ')' };
    }
    var path = args.path == null ? '.' : String(args.path);
    var abs = resolvePath(path);
    if (!inside(abs)) return { allow: false, field: 'path', reason: path + ' resolves to ' + abs + ', outside the workspace (' + ROOT + ')' };
    return { allow: true, reason: 'read-only, inside the workspace' };
  }

  var IMPL = {
    search_files: function (a, files) {
      var base = resolvePath(a.path || '.');
      var hits = [];
      Object.keys(files).sort().forEach(function (f) {
        var abs = resolvePath(f);
        if (abs !== base && abs.indexOf(base + '/') !== 0) return;
        files[f].split('\n').forEach(function (line, i) {
          if (line.indexOf(a.query) !== -1) hits.push(f + ':' + (i + 1) + ': ' + line.trim().replace(/ {2,}/g, ' '));
        });
      });
      var max = a.max_results || 20;
      if (!hits.length) return 'No matches for "' + a.query + '".';
      return hits.slice(0, max).join('\n') + (hits.length > max ? '\n(showing ' + max + ' of ' + hits.length + ' matches)' : '');
    },
    read_file: function (a, files) {
      // The tool itself can read anything the process can. Only the policy check keeps it in the workspace.
      var abs = resolvePath(a.path);
      if (!inside(abs) && OUTSIDE[abs] != null) return OUTSIDE[abs];
      var f = abs.slice(ROOT.length + 1);
      if (files[f] != null) {
        // A bounded read: a whole small file as is, otherwise the requested lines with a header that says which.
        var lines = files[f].split('\n');
        var from = a.offset || 1;
        var n = a.limit || 100;
        if (from === 1 && lines.length <= n) return files[f];
        if (from > lines.length) throw new Error('offset ' + from + ' is past the end of ' + a.path + ' (' + lines.length + ' lines).');
        var part = lines.slice(from - 1, from - 1 + n);
        return 'Lines ' + from + '-' + (from - 1 + part.length) + ' of ' + fmt(lines.length) + ':\n' + part.join('\n');
      }
      var dir = f.split('/').slice(0, -1).join('/');
      var stem = f.split('/').pop().slice(0, 5);
      var similar = Object.keys(files).filter(function (k) {
        return k.split('/').slice(0, -1).join('/') === dir && k.split('/').pop().indexOf(stem) === 0;
      });
      throw new Error('No such file: ' + a.path + '.' + (similar.length ? ' Similar: ' + similar.join(', ') + '.' : ''));
    },
    run_command: function (a) {
      if (COMMANDS[a.cmd] == null) throw new Error('command not found: ' + a.cmd);
      return COMMANDS[a.cmd];
    }
  };

  // Long text keeps a head and a tail, and the marker always says where the full output is.
  function limitText(text, ref) {
    var lines = text.split('\n');
    if (lines.length <= LIMIT.maxLines) return { content: text, truncated: false };
    var omitted = lines.length - LIMIT.head - LIMIT.tail;
    var marker = '[... ' + fmt(omitted) + ' lines truncated. Full output (' + fmt(lines.length) + ' lines) saved to ' + ref + '. Search it or read a line range. ...]';
    return { content: lines.slice(0, LIMIT.head).concat([marker], lines.slice(-LIMIT.tail)).join('\n'), truncated: true, omitted: omitted, artifact: ref };
  }
  // Structured output: drop items, not characters, and say so inside the structure.
  function limitJson(obj, key, keep, ref) {
    var out = {};
    Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
    out[key] = obj[key].filter(keep);
    out['omitted_' + key] = obj[key].length - out[key].length;
    out.truncated = true;
    out.full_output = ref;
    return out;
  }
  function naiveCut(obj, chars) { return JSON.stringify(obj, null, 2).slice(0, chars); }

  // JSON with leaf objects and arrays on one line, so requests stay short.
  function pretty(v, ind) {
    ind = ind || '';
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    var arr = Array.isArray(v);
    var keys = Object.keys(v);
    var leaf = keys.every(function (k) { return v[k] === null || typeof v[k] !== 'object'; });
    var item = function (k) { return (arr ? '' : JSON.stringify(k) + ': ') + pretty(v[k], ind + '  '); };
    if (leaf) return (arr ? '[' : '{') + keys.map(item).join(', ') + (arr ? ']' : '}');
    return (arr ? '[' : '{') + '\n' + keys.map(function (k) { return ind + '  ' + item(k); }).join(',\n') + '\n' + ind + (arr ? ']' : '}');
  }

  /* ---------- scenarios ---------- */

  var LOG_LINES = LOG.split('\n').length;
  var SCENARIOS = {
    valid: {
      label: 'Valid call',
      user: 'Where do we check token expiry?',
      note: 'Vendors name these fields differently, but every API has the same parts: a tool name, arguments, an id, and a result tied to that id.',
      script: [
        { do: 'advertise', tool: 'search_files', title: 'Your code lists the tools',
          say: "Before it calls the model, your code puts each tool's name, description, and argument schema into the context. That text is all the model knows about the tool." },
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'expires_at', max_results: 20 }, ms: 12 }], title: 'The model asks for a call',
          say: 'The model replies with a request: a tool name, arguments, and an id. Nothing has run yet, because the model can only write text.' },
        { do: 'validate', title: 'Your code checks the arguments',
          say: 'Your code checks the arguments against the schema, the way a server checks a request body. Both arguments match, so the call moves on.' },
        { do: 'policy', title: 'Your code checks its rules',
          say: 'Next, your code checks whether this call is allowed. search_files only reads, and only inside the workspace, so it may run without asking anyone.' },
        { do: 'execute', title: 'The tool runs',
          say: 'Your code calls the real search function. This is the first moment anything touches the files.' },
        { do: 'result', title: 'The result goes back',
          say: 'Your code adds the output to the history as a result with the same id, call_1. The model will read it the next time your code calls it.' },
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'auth/session.py' } }], title: 'The model is called again',
          say: 'Your code calls the model again with the whole history. The model reads the matches and asks to read auth/session.py, as call_2.' }
      ]
    },

    'bad-args': {
      label: 'Wrong argument type',
      tag: 'Possible when arguments are not schema-constrained. Some providers can force the arguments to match the schema, and then this error cannot happen. A wrong value of the right type still can.',
      user: 'Show me every place that uses expires_at.',
      script: [
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'expires_at', max_results: 'all' } }], title: 'The model asks for a call',
          say: 'The user wants every match, so the model writes "all" for max_results, even though the schema asks for a number.' },
        { do: 'validate', title: 'The argument check fails',
          say: 'max_results must be a whole number from 1 to 50, so the check fails. Your code does not guess a number, and it does not stop the run.' },
        { do: 'result', title: 'The error goes back as the result',
          say: 'Your code sends the error back as the result of call_1. The message says what was wrong and how to fix it, and nothing ran.' },
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'expires_at', max_results: 50 }, ms: 14 }], title: 'The model retries',
          say: 'The model reads the error and fixes its request. The retry is a new call with a new id, call_2.' },
        { do: 'pass', title: 'The retry runs',
          say: 'call_2 passes both checks, so your code runs it and sends back the matches. The history keeps both attempts, each with its own id.' }
      ]
    },

    policy: {
      label: 'Blocked by a rule',
      user: 'Is the token lifetime too short in production?',
      note: 'A stale object fails in a similar way. Say the model asks to edit text it read ten steps ago, but the file has changed since. The arguments are valid and the path is allowed, yet the edit tool should refuse ("old text not found, read the file again") instead of guessing.',
      script: [
        { do: 'request', calls: [{ name: 'read_file', args: { path: '../deploy/prod.env' } }], title: 'The model asks for a call',
          say: 'The model wants the production settings, so it asks to read ../deploy/prod.env, one folder above the repository.' },
        { do: 'validate', title: 'The argument check passes',
          say: 'The path is a string, so the schema check passes. The schema checks only the form of the argument, not where the path points.' },
        { do: 'policy', title: 'Your rules deny the call',
          say: 'Your code works out the full path first, so the "../" cannot sneak past. The path is outside the workspace, so the rules deny the call before anything runs.' },
        { do: 'result', title: 'The denial goes back as the result',
          say: 'Your code sends the denial back as the result of call_1. The file was never opened, and no wording in a later request can change that, because the check is code.' },
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'config/settings.py' } }], title: 'The model tries another way',
          say: 'The model looks for the setting inside the repository instead, and asks for config/settings.py as call_2.' },
        { do: 'pass', title: 'The new call runs',
          say: 'call_2 passes both checks and runs. The model can now report the default from the code, and say it could not see the production value.' }
      ]
    },

    parallel: {
      label: 'Two calls at once',
      user: "Explain how a token's expiry is set and checked.",
      note: "Only independent calls can run together. If one call depends on another's result, such as reading a file that a search has not found yet, they must run in order, in separate replies. Some runtimes also refuse two writes to the same file in one reply.",
      script: [
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'auth/tokens.py' }, ms: 35 }, { name: 'read_file', args: { path: 'auth/session.py' }, ms: 18 }],
          title: 'The model asks for two calls',
          say: "The model asks for two files in one reply, call_1 and call_2. Neither read needs the other's result, so your code can run them at the same time." },
        { do: 'checks', title: 'Both pass the checks',
          say: 'Both calls pass the schema check and the rules, because they only read files inside the workspace.' },
        { do: 'execute', title: 'Both run at once',
          say: 'Your code starts both. call_2 finishes first, and then call_1 fails because auth/tokens.py does not exist.' },
        { do: 'result', title: 'Results attach by id',
          say: 'Your code sends back one result per call, each with its id, so the finishing order does not matter. The error for call_1 does not erase the file from call_2.' },
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'auth/token_utils.py' } }], title: 'The model handles the failure',
          say: 'The model keeps the code it got and retries the missing file under the name the error suggested, as call_3.' }
      ]
    },

    large: {
      label: 'Huge output',
      user: 'Run the whole test suite and tell me what fails.',
      note: 'Limits here are illustrative: this runtime saves any output over ' + LIMIT.maxLines + ' lines and keeps the first ' + LIMIT.head + ' and the last ' + LIMIT.tail + '. Real limits are larger and often counted in tokens.',
      script: [
        { do: 'request', calls: [{ name: 'run_command', args: { cmd: 'pytest -v' }, ms: 48310 }], title: 'The model asks for a call',
          say: 'The model asks to run the whole test suite with verbose output, as call_1.' },
        { do: 'checks', title: 'Both checks pass',
          say: 'The arguments match the schema, and pytest is on the list of allowed commands, so the rules allow the call.' },
        { do: 'execute', title: 'The command runs',
          say: 'The suite runs for 48 seconds and prints ' + fmt(LOG_LINES) + ' lines, about ' + fmt(Math.round(LOG.length / 4000) * 1000) + ' tokens.' },
        { do: 'limit', title: 'Your code limits the output',
          say: 'That much text would crowd the context, so your code saves the full output to ' + OUT_DIR + 'call_1.log and keeps only the first and last few lines.' },
        { do: 'result', title: 'The preview goes back',
          say: 'The marker in the middle of the preview says how many lines were cut and where the full log is. Without it, the model could take the preview for the whole output.' },
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'test_login_expired_token', path: OUT_DIR + 'call_1.log' }, ms: 9 }], title: 'The model follows the pointer',
          say: 'The model searches the saved log for the failing test, as call_2, instead of running the whole suite again.' },
        { do: 'pass', title: 'The search runs',
          say: 'call_2 returns the matching lines with their line numbers, so the model now knows where the failure details start.' },
        { do: 'request', calls: [{ name: 'read_file', args: { path: OUT_DIR + 'call_1.log', offset: FAIL_LINE, limit: 9 }, ms: 4 }], title: 'The model reads just that part',
          say: 'The details start at line ' + FAIL_LINE + ', so the model asks for nine lines from there, as call_3.' },
        { do: 'pass', title: 'The short read runs',
          say: 'call_3 returns only those nine lines, including the assertion that fails. The rest of the log never entered the context.' },
        { do: 'note', title: 'Cutting JSON breaks it',
          say: 'Suppose the tool had returned JSON instead. Cutting it at a character limit leaves invalid JSON, so a better limit drops whole items and says how many it dropped.',
          points: ['Keep the top-level shape.', 'Drop whole items, not characters.', 'Say how many items were dropped.', 'Point to the full output.'] }
      ]
    }
  };

  var STAGES_FOR = {
    advertise: ['advertise'], request: ['request'], validate: ['validate'], policy: ['policy'],
    checks: ['validate', 'policy'], execute: ['execute'], limit: ['result'], result: ['result'],
    pass: ['validate', 'policy', 'execute', 'result'], note: ['result']
  };
  var ACTOR_FOR = { request: 'model', execute: 'tool' };

  function build(key) {
    var sc = SCENARIOS[key];
    if (!sc) throw new Error('unknown scenario: ' + key);
    var files = clone(FILES);
    var messages = [{ role: 'user', content: sc.user }];
    var calls = [];
    var batch = [];
    var latest = [];
    var executed = [];
    var artifacts = [];
    var counters = { modelCalls: 0, requested: 0, executed: 0, blocked: 0 };
    var view = { kind: 'idle', title: 'What the model asked for', text: '(nothing yet)' };
    var steps = [];
    var seq = 0;

    function blocked(r) { return (r.schema && !r.schema.ok) || (r.policy && !r.policy.ok); }

    function checkSchema(r) {
      if (r.schema) return;
      var errs = validate(r.name, r.args);
      r.schema = { ok: !errs.length, errors: errs };
      if (errs.length) counters.blocked += 1;
    }
    function checkPolicy(r) {
      if (r.policy || !r.schema || !r.schema.ok) return;
      var p = policy(r.name, r.args);
      r.policy = { ok: p.allow, reason: p.reason, field: p.field };
      if (!p.allow) counters.blocked += 1;
    }
    function execute() {
      // Independent calls run at once; they complete in order of duration, not of request.
      batch.filter(function (r) { return r.policy && r.policy.ok && !r.run; })
        .sort(function (a, b) { return a.ms - b.ms; })
        .forEach(function (r, n) {
          executed.push(r.id);
          counters.executed += 1;
          try {
            r.raw = IMPL[r.name](r.args, files);
            r.run = { status: 'done', ms: r.ms, order: n + 1 };
          } catch (e) {
            r.run = { status: 'failed', ms: r.ms, order: n + 1, error: e.message };
          }
        });
      batch.forEach(function (r) { if (!r.run && blocked(r)) r.run = { status: 'not run' }; });
    }
    function limit() {
      batch.forEach(function (r) {
        if (!r.run || r.run.status !== 'done' || r.out) return;
        r.out = limitText(r.raw, OUT_DIR + r.id + '.log');
        if (!r.out.truncated) return;
        files[r.out.artifact] = r.raw;
        artifacts.push({ path: r.out.artifact, lines: r.raw.split('\n').length, bytes: r.raw.length, from: r.id });
      });
    }
    function answer() {
      limit();
      latest = [];
      batch.forEach(function (r) {
        if (r.answered) throw new Error(r.id + ' already has a result');
        if (!r.schema || (!r.run && !blocked(r))) throw new Error(r.id + ' answered before it was checked and run');
        if (!r.run) r.run = { status: 'not run' };
        var m = { role: 'tool', tool_call_id: r.id };
        if (!r.schema.ok) {
          m.is_error = true;
          m.content = 'Invalid arguments for ' + r.name + ': ' + r.schema.errors.map(function (e) { return e.message; }).join(' ') + ' The call did not run.';
        } else if (!r.policy.ok) {
          m.is_error = true;
          m.content = 'Denied by policy: ' + r.policy.reason + '. The call did not run.';
        } else if (r.run.status === 'failed') {
          m.is_error = true;
          m.content = r.run.error;
        } else {
          m.content = r.out.content;
          if (r.out.truncated) { m.truncated = true; m.artifact = r.out.artifact; }
        }
        r.answered = true;
        messages.push(m);
        latest.push(m);
      });
    }

    function snapshot(r) {
      return { id: r.id, name: r.name, args: clone(r.args), schema: clone(r.schema), policy: clone(r.policy), run: clone(r.run), artifact: r.out && r.out.truncated ? r.out.artifact : null };
    }

    sc.script.forEach(function (it) {
      var d = it.do;
      var alt = null;
      if (d === 'advertise') {
        var def = TOOLS[it.tool];
        view = { kind: 'tool', title: 'What the model is told about ' + it.tool, json: { name: it.tool, description: def.description, parameters: def.parameters } };
      } else if (d === 'request') {
        if (batch.some(function (r) { return !r.answered; })) throw new Error('model called again before every call had a result');
        counters.modelCalls += 1;
        var tc = it.calls.map(function (x) { seq += 1; return { id: 'call_' + seq, name: x.name, arguments: clone(x.args) }; });
        var msg = { role: 'assistant', tool_calls: tc };
        messages.push(msg);
        batch = tc.map(function (t, n) { return { id: t.id, name: t.name, args: t.arguments, ms: it.calls[n].ms || 10, schema: null, policy: null, run: null }; });
        calls = calls.concat(batch);
        counters.requested += tc.length;
        latest = [];
        view = { kind: 'request', title: 'What the model asked for', json: msg };
      } else if (d === 'note') {
        var report = { total: SUITE.length, passed: SUITE.length - SUITE.filter(failed).length, failed: SUITE.filter(failed).length, tests: SUITE };
        view = { kind: 'note', title: 'JSON cut at a character limit', text: naiveCut(report, 260), invalid: true };
        alt = { title: 'Better: whole items dropped, and the JSON stays valid', json: limitJson(report, 'tests', failed, OUT_DIR + 'call_1.json') };
      }
      if (d === 'validate' || d === 'checks' || d === 'pass') batch.forEach(checkSchema);
      if (d === 'policy' || d === 'checks' || d === 'pass') batch.forEach(checkPolicy);
      if (d === 'execute' || d === 'pass') execute();
      if (d === 'limit') limit();
      if (d === 'result' || d === 'pass') answer();

      var skipped = [];
      if (batch.length && batch.every(function (r) { return r.schema && !r.schema.ok; })) skipped = ['policy', 'execute'];
      else if (batch.length && batch.every(blocked)) skipped = ['execute'];
      var highlight = [];
      if (view.kind === 'request') {
        batch.forEach(function (r) {
          var fields = r.schema && !r.schema.ok ? r.schema.errors.map(function (e) { return e.field; }) : (r.policy && !r.policy.ok ? [r.policy.field] : []);
          fields.forEach(function (f) { if (f in r.args) highlight.push(JSON.stringify(f) + ': ' + JSON.stringify(r.args[f])); });
        });
      }
      steps.push({
        kind: d, stages: STAGES_FOR[d], skipped: skipped, actor: ACTOR_FOR[d] || 'runtime',
        title: it.title, say: it.say, points: it.points || null,
        view: { kind: view.kind, title: view.title, text: view.text != null ? view.text : pretty(view.json), invalid: !!view.invalid, highlight: highlight },
        alt: alt ? { title: alt.title, json: alt.json, text: pretty(alt.json) } : null,
        batch: batch.map(function (r) { return r.id; }),
        calls: calls.map(snapshot),
        latest: clone(latest),
        messages: clone(messages),
        executed: executed.slice(),
        artifacts: clone(artifacts),
        counters: clone(counters)
      });
    });
    return steps;
  }

  AC.sims['tool-call'] = {
    tools: TOOLS, scenarios: SCENARIOS,
    validate: validate, policy: policy, resolvePath: resolvePath,
    limitText: limitText, limitJson: limitJson, naiveCut: naiveCut,
    build: build
  };

  /* ---------- widget ---------- */

  var STAGES = [
    { key: 'advertise', who: 'Your code', what: 'lists the tools', role: 'runtime' },
    { key: 'request', who: 'Model', what: 'asks for a call', role: 'model' },
    { key: 'validate', who: 'Your code', what: 'checks the arguments', role: 'runtime' },
    { key: 'policy', who: 'Your code', what: 'checks its rules', role: 'runtime' },
    { key: 'execute', who: 'Tool', what: 'does the work', role: 'tool' },
    { key: 'result', who: 'Your code', what: 'returns the result', role: 'runtime' }
  ];
  var STAGE_KEYS = STAGES.map(function (s) { return s.key; });
  var ACTOR = { runtime: 'Your code', model: 'Model', tool: 'Tool' };

  AC.widgets['tool-call'] = function (root) {
    var h = AC.h;
    var keys = Object.keys(SCENARIOS);
    var start = root.getAttribute('data-start');
    var current = SCENARIOS[start] ? start : keys[0];
    var steps = build(current);

    var frame = h('div', { class: 'w-frame tc' });
    frame.appendChild(h('div', { class: 'w-head' },
      h('p', { class: 'w-title', text: root.getAttribute('data-title') || 'The life of a tool call' }),
      h('p', { class: 'w-sub', text: 'Times and sizes are illustrative.' })));
    var body = h('div', { class: 'w-body' });
    frame.appendChild(body);

    var tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Case' });
    keys.forEach(function (k) {
      var b = h('button', { class: 'w-tab', type: 'button', 'data-key': k, text: SCENARIOS[k].label });
      b.addEventListener('click', function () {
        if (k === current) return;
        current = k;
        steps = build(k);
        paintIntro();
        stepper.reset();
      });
      tabs.appendChild(b);
    });
    body.appendChild(tabs);

    var intro = h('div', { class: 'tc-intro' });
    body.appendChild(intro);

    // The main picture: the six stages of one call, colored by who acts.
    var pipe = h('ol', { class: 'tc-pipe', 'aria-hidden': 'true' });
    STAGES.forEach(function (s, n) {
      pipe.appendChild(h('li', { class: 'tc-stage ' + s.role, 'data-key': s.key },
        h('span', { class: 'tc-stage-who', text: (n + 1) + ' · ' + s.who }),
        h('span', { class: 'tc-stage-what', text: s.what })));
    });
    body.appendChild(pipe);

    var stats = h('div', { class: 'tc-stats', 'aria-label': 'Counts' });
    var paneA = h('div', { class: 'w-panel tc-panel' });
    var paneB = h('div', { class: 'w-panel tc-panel' });
    var paneC = h('div', { class: 'w-panel tc-panel tc-wide' });
    var note = h('p', { class: 'w-note tc-note' });

    function paintIntro() {
      var sc = SCENARIOS[current];
      tabs.querySelectorAll('.w-tab').forEach(function (t) {
        var on = t.getAttribute('data-key') === current;
        t.setAttribute('aria-pressed', String(on));
        t.setAttribute('aria-pressed', String(on));
      });
      intro.textContent = '';
      intro.appendChild(h('p', { class: 'tc-user' }, h('span', { class: 'badge user', text: 'User' }), sc.user));
      if (sc.tag) intro.appendChild(h('p', { class: 'tc-tag' }, h('strong', { text: 'Note: ' }), sc.tag));
      note.textContent = sc.note || '';
      note.hidden = !sc.note;
    }

    // One block per line with a hanging indent, so wrapped JSON keeps its shape in narrow panels.
    function codeBlock(text, highlight) {
      var pre = h('pre', { class: 'w-json tc-json' });
      text.split('\n').forEach(function (line) {
        var indent = line.match(/^ */)[0].length;
        var body = line.slice(indent);
        var row = h('span', { class: 'tc-line', style: { paddingLeft: (indent + 2) + 'ch' } });
        var hit = (highlight || []).filter(function (s) { return body.indexOf(s) !== -1; })[0];
        if (!hit) row.textContent = body || ' ';
        else {
          var at = body.indexOf(hit);
          row.appendChild(document.createTextNode(body.slice(0, at)));
          row.appendChild(h('mark', { class: 'tc-bad', text: hit }));
          row.appendChild(document.createTextNode(body.slice(at + hit.length)));
        }
        pre.appendChild(row);
      });
      return pre;
    }

    function row(dl, label, cls, word, detail) {
      dl.appendChild(h('dt', { text: label }));
      dl.appendChild(h('dd', null, h('span', { class: 'w-status ' + cls, text: word }), detail ? ' ' + detail : ''));
    }

    function paintA(s) {
      paneA.textContent = '';
      paneA.appendChild(h('p', { class: 'w-panel-title', text: s.view.title }));
      paneA.appendChild(codeBlock(s.view.text, s.view.highlight));
      if (s.view.highlight.length) paneA.appendChild(h('p', { class: 'w-note', text: 'Marked: the argument your code rejected.' }));
      if (s.view.invalid) paneA.appendChild(h('p', { class: 'w-warn', text: 'Invalid JSON: the text stops in the middle of an object, so a parser fails here.' }));
    }

    function paintB(s) {
      paneB.textContent = '';
      paneB.appendChild(h('p', { class: 'w-panel-title', text: s.points ? 'How to limit structured output' : 'What your code checked and ran' }));
      if (s.points) {
        var ul = h('ul', { class: 'tc-points' });
        s.points.forEach(function (p) { ul.appendChild(h('li', { text: p })); });
        paneB.appendChild(ul);
        return;
      }
      if (!s.batch.length) {
        paneB.appendChild(h('p', { class: 'tc-quiet', text: 'Nothing has been asked for yet. These tools are on offer, with what each can change:' }));
        var dl0 = h('dl', { class: 'w-kv' });
        Object.keys(TOOLS).forEach(function (n) { dl0.appendChild(h('dt', { text: n })); dl0.appendChild(h('dd', { text: TOOLS[n].effect })); });
        paneB.appendChild(dl0);
        paneB.appendChild(h('p', { class: 'w-note', text: 'Rules in this runtime: file tools stay inside ' + ROOT + ', and commands must be on the list: ' + ALLOW_CMDS.join(', ') + '.' }));
        return;
      }
      var recs = s.calls.filter(function (r) { return s.batch.indexOf(r.id) !== -1; });
      recs.forEach(function (r) {
        var card = h('div', { class: 'tc-call' });
        card.appendChild(h('p', { class: 'tc-call-head' }, h('code', { text: r.id }), ' ' + r.name));
        var dl = h('dl', { class: 'w-kv' });
        if (!r.schema) row(dl, 'Arguments', 'mid', 'waiting', 'not checked yet');
        else if (r.schema.ok) row(dl, 'Arguments', 'ok', 'ok', 'match the schema');
        else row(dl, 'Arguments', 'bad', 'wrong', r.schema.errors.map(function (e) { return e.message; }).join(' '));
        if (r.policy) row(dl, 'Rules', r.policy.ok ? 'ok' : 'bad', r.policy.ok ? 'allowed' : 'denied', r.policy.reason);
        else if (r.schema && !r.schema.ok) row(dl, 'Rules', 'mid', 'skipped', 'the arguments were wrong');
        else row(dl, 'Rules', 'mid', 'waiting', 'not checked yet');
        var stopped = (r.schema && !r.schema.ok) || (r.policy && !r.policy.ok);
        if (stopped || (r.run && r.run.status === 'not run')) row(dl, 'Ran', 'bad', 'no', 'blocked before running');
        else if (!r.run) row(dl, 'Ran', 'mid', 'not yet');
        else if (r.run.status === 'failed') row(dl, 'Ran', 'bad', 'failed', r.run.error + ' (' + ms(r.run.ms) + ')');
        else row(dl, 'Ran', 'ok', 'yes', 'in ' + ms(r.run.ms) + (r.artifact ? '. Full output saved to ' + r.artifact : ''));
        card.appendChild(dl);
        paneB.appendChild(card);
      });
      var ran = recs.filter(function (r) { return r.run && r.run.ms; });
      if (ran.length > 1) {
        var max = Math.max.apply(null, ran.map(function (r) { return r.run.ms; }));
        var bars = h('div', { class: 'tc-bars' }, h('p', { class: 'w-panel-title', text: 'Which finished first' }));
        ran.forEach(function (r) {
          bars.appendChild(h('div', { class: 'tc-bar-row' },
            h('code', { text: r.id }),
            h('span', { class: 'tc-bar-track' }, h('span', { class: 'tc-bar ' + (r.run.status === 'done' ? 'tool' : 'is-failed'), style: { width: (100 * r.run.ms / max) + '%' } })),
            h('span', { class: 'tc-bar-label', text: (r.run.order === 1 ? 'first' : 'second') + ', ' + r.run.status + ', ' + ms(r.run.ms) })));
        });
        paneB.appendChild(bars);
      }
    }

    function paintC(s) {
      paneC.textContent = '';
      if (s.alt) {
        paneC.appendChild(h('p', { class: 'w-panel-title', text: s.alt.title }));
        paneC.appendChild(codeBlock(s.alt.text));
      } else {
        paneC.appendChild(h('p', { class: 'w-panel-title', text: 'What goes back to the model' }));
        if (s.latest.length) {
          var grid = h('div', { class: 'tc-results' });
          s.latest.forEach(function (m) {
            var card = h('div', { class: 'tc-result' });
            var dl = h('dl', { class: 'w-kv' });
            dl.appendChild(h('dt', { text: 'For call' }));
            dl.appendChild(h('dd', null, h('code', { text: m.tool_call_id })));
            row(dl, 'Error', m.is_error ? 'bad' : 'ok', m.is_error ? 'yes' : 'no');
            if (m.truncated) row(dl, 'Cut short', 'mid', 'yes', 'full output in ' + m.artifact);
            card.appendChild(dl);
            card.appendChild(h('pre', { class: 'tc-content', text: m.content }));
            grid.appendChild(card);
          });
          paneC.appendChild(grid);
        } else {
          paneC.appendChild(h('p', { class: 'tc-idle', text: 'Nothing yet. The model is not running, and it sees a result only when your code calls it again.' }));
        }
      }
      var hist = h('ol', { class: 'tc-hist', 'aria-label': 'History so far' });
      s.messages.forEach(function (m) {
        var label = m.role === 'assistant' ? 'model asks: ' + m.tool_calls.map(function (c) { return c.id; }).join(', ')
          : m.role === 'tool' ? 'result: ' + m.tool_call_id + (m.is_error ? ' (error)' : m.truncated ? ' (cut short)' : '') : 'user asks';
        hist.appendChild(h('li', { class: 'w-pill ' + (m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'tool' : 'user'), text: label }));
      });
      paneC.appendChild(h('p', { class: 'w-panel-title tc-hist-title', text: 'History so far' }));
      paneC.appendChild(hist);
    }

    function render(i, narration) {
      var s = steps[i];
      var first = STAGE_KEYS.indexOf(s.stages[0]);
      pipe.querySelectorAll('.tc-stage').forEach(function (n, idx) {
        var k = n.getAttribute('data-key');
        var active = s.stages.indexOf(k) !== -1;
        var skipped = s.skipped.indexOf(k) !== -1;
        n.classList.toggle('is-active', active);
        n.classList.toggle('is-skipped', skipped);
        n.classList.toggle('is-done', !active && !skipped && idx < first);
      });
      narration.appendChild(h('p', { class: 'tc-say' },
        h('span', { class: 'badge ' + s.actor, text: ACTOR[s.actor] }),
        h('span', { class: 'w-step-title', text: s.title + '. ' }), s.say));
      stats.textContent = '';
      var ranN = s.counters.executed;
      var blockedN = s.counters.blocked;
      [[ranN, ranN === 1 ? 'call ran' : 'calls ran'], [blockedN, (blockedN === 1 ? 'call' : 'calls') + ' blocked before running']].forEach(function (c) {
        stats.appendChild(h('span', { class: 'tc-stat' }, h('span', { class: 'tc-stat-num', text: String(c[0]) }), h('span', { class: 'tc-stat-label', text: c[1] })));
      });
      paintA(s);
      paintB(s);
      paintC(s);
    }

    var stepper = AC.stepper({ count: function () { return steps.length; }, render: render });
    body.appendChild(stepper.el);
    body.appendChild(stats);
    body.appendChild(h('div', { class: 'w-grid cols-2 tc-grid' }, paneA, paneB, paneC));
    body.appendChild(note);
    root.appendChild(frame);
    paintIntro();
    stepper.go(0);
  };
})();
