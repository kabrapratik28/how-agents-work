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
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative to the workspace root' } }, required: ['path'], additionalProperties: false }
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
    lines.push('____________________ test_login_expired_token ____________________', '',
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
        errs.push({ field: k, message: k + ' must be an integer from ' + p.minimum + ' to ' + p.maximum + ' (got ' + JSON.stringify(v) + ').' + hint });
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
      if (files[f] != null) return files[f];
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
      note: 'Vendor APIs name these fields differently. The shape is the same everywhere: a tool name, arguments, an id, and a result tied to that id.',
      script: [
        { do: 'advertise', tool: 'search_files', title: 'The runtime lists the tools',
          say: 'Before the call, the runtime puts the tool definitions into the context. Each has a name, a description, and a schema for its arguments. That text is all the model knows about the tool.' },
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'expires_at', max_results: 20 }, ms: 12 }], title: 'The model asks for a call',
          say: 'The model replies with a request: a tool name, arguments, and an id. Nothing has run. A request is only output.' },
        { do: 'validate', title: 'The runtime checks the schema',
          say: 'The runtime treats the arguments as untrusted input. It checks them against the schema, the way a server checks a request body.' },
        { do: 'policy', title: 'The runtime checks policy',
          say: 'Valid is not the same as allowed. This tool only reads, and only inside the workspace, so the policy lets it run without asking anyone.' },
        { do: 'execute', title: 'The runtime runs the tool',
          say: 'Now the runtime calls ordinary code: the real search function. This is the first moment anything touches the files.' },
        { do: 'result', title: 'The result goes back',
          say: 'The runtime wraps the output as a tool result with the same id, call_1, and appends it to the history. The model reads it on its next call.' },
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'auth/session.py' } }], title: 'The model is called again',
          say: 'The runtime calls the model again with the whole history. The model reads the matches and asks for auth/session.py, as call_2. The cycle repeats.' }
      ]
    },

    'bad-args': {
      label: 'Bad argument type',
      tag: 'Possible when arguments are not schema-constrained. Some providers can force the arguments to match the schema. Then this type error cannot happen, but a wrong value of the right type still can.',
      user: 'Show me every place that uses expires_at.',
      script: [
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'expires_at', max_results: 'all' } }], title: 'The model asks for a call',
          say: 'The user wants every match, so the model writes "all" for max_results. The schema says integer. Nothing forced the model to follow it.' },
        { do: 'validate', title: 'The schema check fails',
          say: 'max_results must be an integer from 1 to 50. The runtime does not guess a number, and it does not crash the run.' },
        { do: 'result', title: 'The error goes back as a result',
          say: 'The error becomes the result of call_1, marked as an error. It says what was wrong and how to fix it. Nothing ran.' },
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'expires_at', max_results: 50 }, ms: 14 }], title: 'The model retries',
          say: 'The model reads the error and fixes its request. The retry is a new call with a new id, call_2. The model chose the fix, not the runtime.' },
        { do: 'pass', title: 'The retry runs',
          say: 'call_2 passes the schema and the policy, runs, and returns the matches. The history keeps both attempts, each tied to its own id.' }
      ]
    },

    policy: {
      label: 'Blocked by policy',
      user: 'Is the token lifetime too short in production?',
      note: 'Stale objects fail in a similar way. Say the model asks to edit text it read ten steps ago, and the file has changed since. The arguments are valid and the path is allowed. The edit tool should refuse ("old text not found, read the file again") instead of guessing.',
      script: [
        { do: 'request', calls: [{ name: 'read_file', args: { path: '../deploy/prod.env' } }], title: 'The model asks for a call',
          say: 'The model wants the production settings. It asks to read ../deploy/prod.env, one folder above the repository.' },
        { do: 'validate', title: 'The schema check passes',
          say: 'The path is a string, so the schema check passes. A schema checks shape, not meaning.' },
        { do: 'policy', title: 'The policy check denies it',
          say: 'The runtime resolves the path first, so "../" cannot sneak past. It lands outside the workspace. The policy denies the call before anything runs.' },
        { do: 'result', title: 'The denial goes back as a result',
          say: 'The denial becomes the result of call_1. The file was never opened. No wording in a later request can change that, because the check is code.' },
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'config/settings.py' } }], title: 'The model adapts',
          say: 'The model looks for the setting inside the repository instead. It asks for config/settings.py, as call_2.' },
        { do: 'pass', title: 'The new call runs',
          say: 'call_2 passes both checks and runs. The model can report the default from the code, and say it could not see the production value.' }
      ]
    },

    parallel: {
      label: 'Parallel calls',
      user: "Explain how a token's expiry is set and checked.",
      note: "Only independent calls can run in parallel. If one call needs another's result, such as reading a file that a search has not found yet, the calls must run in order, in separate replies. Some runtimes also refuse two writes to the same file in one reply.",
      script: [
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'auth/tokens.py' }, ms: 35 }, { name: 'read_file', args: { path: 'auth/session.py' }, ms: 18 }],
          title: 'The model asks for two calls',
          say: "The model asks for two files in one reply, call_1 and call_2. Neither needs the other's result, so they can run at the same time." },
        { do: 'checks', title: 'Both pass the checks',
          say: 'Both pass the schema and the policy. They only read, and only inside the workspace.' },
        { do: 'execute', title: 'Both run at once',
          say: 'The runtime starts both. call_2 finishes first. Then call_1 fails, because there is no auth/tokens.py. Completion order is not request order.' },
        { do: 'result', title: 'Results attach by id',
          say: 'The runtime appends one result per call, each tied to its id. The error belongs to call_1 and the file to call_2. One failure does not throw away the other result.' },
        { do: 'request', calls: [{ name: 'read_file', args: { path: 'auth/token_utils.py' } }], title: 'The model handles the partial failure',
          say: 'The model keeps the session code it got. It retries the missing file under the name the error suggested, as call_3.' }
      ]
    },

    large: {
      label: 'Large output',
      user: 'Run the whole test suite and tell me what fails.',
      note: 'Limits here are illustrative. This runtime saves any output over ' + LIMIT.maxLines + ' lines and keeps the first ' + LIMIT.head + ' and the last ' + LIMIT.tail + '. Real limits are larger and often counted in tokens.',
      script: [
        { do: 'request', calls: [{ name: 'run_command', args: { cmd: 'pytest -v' }, ms: 48310 }], title: 'The model asks for a call',
          say: 'The model asks to run the whole suite with verbose output, as call_1.' },
        { do: 'checks', title: 'Both checks pass',
          say: 'The schema check passes. pytest is on the command allowlist, so the policy allows it.' },
        { do: 'execute', title: 'The command runs',
          say: 'The suite runs for 48 seconds and exits with code 1. It prints ' + fmt(LOG_LINES) + ' lines, about ' + fmt(Math.round(LOG.length / 4000) * 1000) + ' tokens. A failing test run is still a successful tool call: the output is the information.' },
        { do: 'limit', title: 'The runtime limits the output',
          say: 'That much text would crowd the context. The runtime saves the full output to ' + OUT_DIR + 'call_1.log. It keeps the head and the tail, because the tail holds the summary.' },
        { do: 'result', title: 'The preview goes back',
          say: 'The result says it was cut, how much was cut, and where the rest is. Without that marker, the model could take the preview for the whole output.' },
        { do: 'request', calls: [{ name: 'search_files', args: { query: 'test_login_expired_token', path: OUT_DIR + 'call_1.log' }, ms: 9 }], title: 'The model follows the reference',
          say: 'The model searches the saved log for the failing test, as call_2. It does not rerun the suite or ask for the whole log.' },
        { do: 'pass', title: 'The search runs',
          say: 'call_2 returns the matching lines with line numbers. The model can now read just that part of the log.' },
        { do: 'note', title: 'Structured output breaks when cut',
          say: 'Suppose the tool had returned JSON instead. A cut at a character limit leaves invalid JSON. A better limit keeps the structure, drops items, counts them, and points to the full file.',
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
    var view = { kind: 'idle', title: 'Model output', text: '(the model has not been called yet)' };
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
        view = { kind: 'tool', title: 'Tool definition, as sent in the context', json: { name: it.tool, description: def.description, parameters: def.parameters } };
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
        view = { kind: 'request', title: 'Model output: a request, not an action', json: msg };
      } else if (d === 'note') {
        var report = { total: SUITE.length, passed: SUITE.length - SUITE.filter(failed).length, failed: SUITE.filter(failed).length, tests: SUITE };
        view = { kind: 'note', title: 'Cut at a character limit (shown short)', text: naiveCut(report, 260), invalid: true };
        alt = { title: 'Structure kept: valid JSON', json: limitJson(report, 'tests', failed, OUT_DIR + 'call_1.json') };
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
    { key: 'advertise', label: 'Advertise', role: 'runtime' },
    { key: 'request', label: 'Model requests', role: 'model' },
    { key: 'validate', label: 'Validate', role: 'runtime' },
    { key: 'policy', label: 'Check policy', role: 'runtime' },
    { key: 'execute', label: 'Execute', role: 'tool' },
    { key: 'result', label: 'Return result', role: 'runtime' }
  ];
  var ACTOR = { runtime: 'Runtime', model: 'Model', tool: 'Tool' };

  AC.widgets['tool-call'] = function (root) {
    var h = AC.h;
    var keys = Object.keys(SCENARIOS);
    var start = root.getAttribute('data-start');
    var current = SCENARIOS[start] ? start : keys[0];
    var steps = build(current);

    var frame = h('div', { class: 'w-frame' });
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
    var strip = h('ol', { class: 'tc-strip', 'aria-hidden': 'true' });
    STAGES.forEach(function (s, n) {
      strip.appendChild(h('li', null,
        h('span', { class: 'tc-stage ' + s.role, 'data-key': s.key, text: s.label }),
        n < STAGES.length - 1 ? h('span', { class: 'tc-arrow', text: '→' }) : null));
    });
    body.appendChild(strip);

    var counters = h('div', { class: 'w-counters', 'aria-label': 'Counters' });
    var paneA = h('div', { class: 'w-panel tc-panel' });
    var paneB = h('div', { class: 'w-panel tc-panel' });
    var paneC = h('div', { class: 'w-panel tc-panel tc-wide' });
    var note = h('p', { class: 'w-note' });

    function paintIntro() {
      var sc = SCENARIOS[current];
      tabs.querySelectorAll('.w-tab').forEach(function (t) {
        var on = t.getAttribute('data-key') === current;
        t.setAttribute('aria-selected', String(on));
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

    function statusRow(dl, label, cls, word, detail) {
      dl.appendChild(h('dt', { text: label }));
      dl.appendChild(h('dd', null, h('span', { class: 'w-status ' + cls, text: word }), detail ? ' ' + detail : ''));
    }

    function paintA(s) {
      paneA.textContent = '';
      paneA.appendChild(h('p', { class: 'w-panel-title', text: s.view.title }));
      paneA.appendChild(codeBlock(s.view.text, s.view.highlight));
      if (s.view.highlight.length) paneA.appendChild(h('p', { class: 'w-note', text: 'Marked: the argument the runtime rejected.' }));
      if (s.view.invalid) paneA.appendChild(h('p', { class: 'w-warn', text: 'Invalid JSON: the text stops in the middle of an object. A parser fails here.' }));
    }

    function paintB(s) {
      paneB.textContent = '';
      paneB.appendChild(h('p', { class: 'w-panel-title', text: s.points ? 'Limiting structured output' : 'Runtime: checks and execution' }));
      if (s.points) {
        var ul = h('ul', { class: 'tc-points' });
        s.points.forEach(function (p) { ul.appendChild(h('li', { text: p })); });
        paneB.appendChild(ul);
        return;
      }
      if (!s.batch.length) {
        var dl0 = h('dl', { class: 'w-kv' });
        Object.keys(TOOLS).forEach(function (n) { dl0.appendChild(h('dt', { text: n })); dl0.appendChild(h('dd', { text: TOOLS[n].effect })); });
        paneB.appendChild(dl0);
        paneB.appendChild(h('p', { class: 'w-note', text: 'Policy in this runtime: file tools stay inside ' + ROOT + '. Commands must match the allowlist: ' + ALLOW_CMDS.join(', ') + '. Nothing has been requested yet.' }));
        return;
      }
      var recs = s.calls.filter(function (r) { return s.batch.indexOf(r.id) !== -1; });
      recs.forEach(function (r) {
        var card = h('div', { class: 'tc-call' });
        card.appendChild(h('p', { class: 'tc-call-head' }, h('code', { text: r.id }), ' ' + r.name));
        var dl = h('dl', { class: 'w-kv' });
        if (!r.schema) statusRow(dl, 'schema', 'mid', 'pending');
        else if (r.schema.ok) statusRow(dl, 'schema', 'ok', 'pass', 'matches the schema');
        else statusRow(dl, 'schema', 'bad', 'fail', r.schema.errors.map(function (e) { return e.message; }).join(' '));
        if (r.policy) statusRow(dl, 'policy', r.policy.ok ? 'ok' : 'bad', r.policy.ok ? 'allow' : 'deny', r.policy.reason);
        else statusRow(dl, 'policy', 'mid', r.schema && !r.schema.ok ? 'skipped' : 'pending');
        if (!r.run) statusRow(dl, 'run', 'mid', 'pending', 'nothing has run');
        else if (r.run.status === 'not run') statusRow(dl, 'run', 'bad', 'not run', 'blocked before execution');
        else if (r.run.status === 'failed') statusRow(dl, 'run', 'bad', 'failed', r.run.error + ' (' + ms(r.run.ms) + ')');
        else statusRow(dl, 'run', 'ok', 'done', ms(r.run.ms) + (r.artifact ? ', full output saved to ' + r.artifact : ''));
        card.appendChild(dl);
        paneB.appendChild(card);
      });
      var ran = recs.filter(function (r) { return r.run && r.run.ms; });
      if (ran.length > 1) {
        var max = Math.max.apply(null, ran.map(function (r) { return r.run.ms; }));
        var bars = h('div', { class: 'tc-bars' }, h('p', { class: 'w-panel-title', text: 'Completion order' }));
        ran.forEach(function (r) {
          bars.appendChild(h('div', { class: 'tc-bar-row' },
            h('code', { text: r.id }),
            h('span', { class: 'tc-bar-track' }, h('span', { class: 'tc-bar ' + (r.run.status === 'done' ? 'tool' : 'is-failed'), style: { width: (100 * r.run.ms / max) + '%' } })),
            h('span', { class: 'tc-bar-label', text: ms(r.run.ms) + ', ' + (r.run.order === 1 ? '1st' : r.run.order === 2 ? '2nd' : r.run.order + 'th') + ', ' + r.run.status })));
        });
        paneB.appendChild(bars);
      }
    }

    function paintC(s) {
      paneC.textContent = '';
      if (s.alt) {
        paneC.appendChild(h('p', { class: 'w-panel-title', text: s.alt.title }));
        paneC.appendChild(codeBlock(s.alt.text));
      } else if (s.latest.length) {
        paneC.appendChild(h('p', { class: 'w-panel-title', text: s.latest.length > 1 ? 'Tool results, appended to the history' : 'Tool result, appended to the history' }));
        var grid = h('div', { class: 'tc-results' });
        s.latest.forEach(function (m) {
          var card = h('div', { class: 'tc-result' });
          var dl = h('dl', { class: 'w-kv' });
          dl.appendChild(h('dt', { text: 'tool_call_id' }));
          dl.appendChild(h('dd', null, h('code', { text: m.tool_call_id })));
          dl.appendChild(h('dt', { text: 'is_error' }));
          dl.appendChild(h('dd', null, h('span', { class: 'w-status ' + (m.is_error ? 'bad' : 'ok'), text: m.is_error ? 'true' : 'false' })));
          if (m.truncated) {
            dl.appendChild(h('dt', { text: 'truncated' }));
            dl.appendChild(h('dd', { text: 'true, full output: ' + m.artifact }));
          }
          card.appendChild(dl);
          card.appendChild(h('pre', { class: 'tc-content', text: m.content }));
          grid.appendChild(card);
        });
        paneC.appendChild(grid);
      } else {
        paneC.appendChild(h('p', { class: 'w-panel-title', text: 'Back to the model' }));
        paneC.appendChild(h('p', { class: 'tc-idle', text: 'No result yet. The model is not running. It sees a result only when the runtime calls it again.' }));
      }
      var hist = h('ol', { class: 'tc-hist', 'aria-label': 'History the model will see on its next call' });
      s.messages.forEach(function (m) {
        var label = m.role === 'assistant' ? 'assistant: ' + m.tool_calls.map(function (c) { return c.id; }).join(', ')
          : m.role === 'tool' ? 'tool: ' + m.tool_call_id + (m.is_error ? ' (error)' : m.truncated ? ' (truncated)' : '') : m.role;
        hist.appendChild(h('li', { class: 'w-pill ' + (m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'tool' : 'user'), text: label }));
      });
      paneC.appendChild(h('p', { class: 'w-panel-title tc-hist-title', text: 'History for the next model call' }));
      paneC.appendChild(hist);
    }

    function render(i, narration) {
      var s = steps[i];
      strip.querySelectorAll('.tc-stage').forEach(function (n) {
        var k = n.getAttribute('data-key');
        n.classList.toggle('is-active', s.stages.indexOf(k) !== -1);
        n.classList.toggle('is-skipped', s.skipped.indexOf(k) !== -1);
      });
      narration.appendChild(h('p', { class: 'tc-say' },
        h('span', { class: 'badge ' + s.actor, text: ACTOR[s.actor] }),
        h('span', { class: 'w-step-title', text: s.title + '. ' }), s.say));
      counters.textContent = '';
      [['Model calls', s.counters.modelCalls], ['Tool calls requested', s.counters.requested],
        ['Executed', s.counters.executed], ['Blocked before running', s.counters.blocked]].forEach(function (c) {
        counters.appendChild(h('span', { class: 'w-counter', text: c[0] + ': ' + c[1] }));
      });
      paintA(s);
      paintB(s);
      paintC(s);
    }

    var stepper = AC.stepper({ count: function () { return steps.length; }, render: render });
    body.appendChild(stepper.el);
    body.appendChild(counters);
    body.appendChild(h('div', { class: 'w-grid cols-2 tc-grid' }, paneA, paneB, paneC));
    body.appendChild(note);
    root.appendChild(frame);
    paintIntro();
    stepper.go(0);
  };
})();
