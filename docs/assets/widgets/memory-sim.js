/* Memory simulator (chapter 05): the external memory store versus the context of one call.
   Five requests run through one retrieval pipeline: query and filters, keyword and vector candidates,
   rerank under a token budget, provenance check, injection. A sixth tab runs the write path for the
   memories one run proposed. AC.sims['memory-sim'] is pure and tested by tools/sims/memory-sim.test.mjs.
   Vector and rerank scores are simulated. Dates and token counts are illustrative. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  var SCOPES = ['project', 'user'];   // Patch works on one project for one user
  var BUDGET = 500;                   // tokens of retrieved memory per call
  var THRESHOLD = 0.5;                // minimum relevance score from the reranker
  var TODAY = '2026-10-19';
  var SOURCE_CHANGED = { 'notify/email.py': '2026-09-30' };   // last change to each source file

  // One store. Pinned facts render into the memory file; the rest is searched per request.
  var STORE = [
    { id: 'user-ts', label: 'TypeScript preference', type: 'fact', key: 'user.frontend', value: 'TypeScript', text: 'User prefers TypeScript for front-end code.', scope: 'user', source: 'user, in chat', verified: '2026-03-02', status: 'accepted', pinned: true, tokens: 12 },
    { id: 'db-engine', label: 'PostgreSQL fact', type: 'fact', key: 'db.engine', value: 'PostgreSQL 15', text: 'Project uses PostgreSQL 15.', scope: 'project', source: 'infra/db.tf', verified: '2026-10-02', status: 'accepted', pinned: true, tokens: 10 },
    { id: 'deploy-aws', label: 'AWS fact', type: 'fact', key: 'deploy.platform', value: 'AWS', text: 'Deployment platform is AWS (ECS).', scope: 'project', source: 'infra/main.tf', verified: '2026-09-12', status: 'accepted', pinned: true, tokens: 10 },
    { id: 'py-version', label: 'Python version fact', type: 'fact', key: 'python.version', value: 'Python 3.11', text: 'The API runs on Python 3.11.', scope: 'project', source: 'Dockerfile', verified: '2026-04-10', status: 'accepted', pinned: true, tokens: 10 },
    { id: 'conv-endpoints', label: 'endpoint rule', type: 'fact', key: 'conv.endpoints', text: 'New endpoints need a rate limit and an audit-log entry.', scope: 'project', source: 'review on PR #212', verified: '2026-09-18', status: 'accepted', tokens: 35 },
    { id: 'email-ses', label: 'email fact', type: 'fact', key: 'email.provider', text: 'Transactional email goes through AWS SES via notify.send_email().', scope: 'project', source: 'notify/email.py', verified: '2025-11-02', status: 'accepted', tokens: 40 },
    { id: 'ep-reset', label: 'reset-token note', type: 'episode', text: 'Jun 2026 run: review rejected reusable password-reset tokens. Make them single-use, valid for 30 minutes.', scope: 'project', source: 'run trace 2026-06-14', verified: '2026-06-14', status: 'accepted', tokens: 90 },
    { id: 'ep-flaky', label: 'flaky-test note', type: 'episode', text: 'Aug 2026 run: test_login_lockout flaked in CI because the rate limiter read wall-clock time. Freezing time in the fixture fixed it.', scope: 'project', source: 'run trace 2026-08-21', verified: '2026-08-21', status: 'accepted', tokens: 110 },
    { id: 'doc-login', label: 'login-flow doc', type: 'doc', text: 'Login flow: POST /login checks the password hash, then issues a session token.', scope: 'project', source: 'docs/auth.md', verified: '2026-07-01', status: 'accepted', tokens: 160 },
    { id: 'proc-deploy', label: 'deploy steps', type: 'procedure', text: 'deploy-staging: build the image, run migrations on staging, deploy, then check /healthz.', scope: 'project', source: 'skills/deploy-staging/SKILL.md', verified: '2026-09-25', status: 'accepted', tokens: 420 },
    { id: 'staging-url', label: 'staging address', type: 'fact', key: 'staging.url', text: 'Staging runs at staging.patch.internal on the ECS cluster patch-staging.', scope: 'project', source: 'infra/staging.tf', verified: '2026-10-01', status: 'accepted', tokens: 40 },
    { id: 'deploy-window', label: 'deploy-day rule', type: 'fact', key: 'deploy.window', value: 'any weekday', text: 'Staging deploys are allowed on any weekday.', scope: 'project', source: 'docs/runbook.md', verified: '2026-05-04', status: 'accepted', tokens: 30 },
    { id: 'ep-deploy', label: 'failed-deploy note', type: 'episode', text: 'May 2026 run: a staging deploy failed because migrations ran after the new code started.', scope: 'project', source: 'run trace 2026-05-09', verified: '2026-05-09', status: 'accepted', tokens: 120 },
    { id: 'migrations', label: 'migrations rule', type: 'fact', key: 'db.migrations', text: 'Migrations use Alembic, one per PR. Never edit an applied migration.', scope: 'project', source: 'docs/db.md', verified: '2026-09-02', status: 'accepted', tokens: 45 },
    { id: 'ep-dupes', label: 'duplicate-email note', type: 'episode', text: 'Jul 2026 run: a unique index on users.email failed until duplicate rows were merged.', scope: 'project', source: 'run trace 2026-07-22', verified: '2026-07-22', status: 'accepted', tokens: 100 },
    { id: 'legacy-mysql', label: 'analytics MySQL note', type: 'fact', key: 'db.engine', value: 'MySQL 5.7', text: 'The analytics service uses MySQL 5.7; migrations run with Flyway.', scope: 'legacy-analytics', source: 'services/legacy-analytics/README.md', verified: '2025-03-11', status: 'accepted', tokens: 30 },
    { id: 'prop-redis', label: 'Redis guess', type: 'fact', key: 'session.store', text: 'Sessions are cached in Redis.', scope: 'project', source: 'model guess, run 2026-10-11', verified: null, status: 'proposed', tokens: 15 }
  ];

  // vector: the 4 nearest neighbors a vector search returns. rerank: relevance to this request.
  var PRESETS = {
    index: {
      label: 'Add an index',
      request: 'Add a migration with a unique index on users.email.',
      keywords: ['migration', 'unique index', 'users.email'],
      vector: { 'legacy-mysql': 0.86, 'migrations': 0.79, 'ep-dupes': 0.77, 'ep-deploy': 0.52 },
      rerank: { 'ep-dupes': 0.92, 'migrations': 0.88, 'ep-deploy': 0.25, 'proc-deploy': 0.18 },
      notice: {
        candidates: 'The closest note by meaning is about another service, which uses MySQL.',
        rerank: 'The migrations rule is a structured fact that was found by meaning, so it counts as two kinds of memory at once.'
      },
      outcome: 'The model writes an Alembic migration and checks for duplicate emails first, and it never sees the MySQL note.'
    },
    reset: {
      label: 'Password reset',
      request: 'Add a password-reset endpoint that emails a reset link.',
      keywords: ['password', 'reset', 'endpoint', 'email', 'token'],
      vector: { 'ep-reset': 0.84, 'conv-endpoints': 0.71, 'email-ses': 0.69, 'doc-login': 0.58 },
      rerank: { 'ep-reset': 0.94, 'email-ses': 0.83, 'conv-endpoints': 0.80, 'doc-login': 0.35, 'ep-dupes': 0.15 },
      notice: {
        rerank: 'The login-flow doc is on the same topic, but this task does not need it.'
      },
      outcome: 'The model follows two rules it could not have guessed, single-use reset tokens and a rate limit, and reads notify/email.py first because that fact is out of date.'
    },
    flaky: {
      label: 'Flaky login test',
      request: 'test_login_rate_limit fails about one run in ten on CI. Fix it.',
      keywords: ['test_login_rate_limit', 'rate limit', 'login', 'ci'],
      vector: { 'doc-login': 0.81, 'prop-redis': 0.66, 'ep-flaky': 0.64, 'ep-reset': 0.42 },
      rerank: { 'ep-flaky': 0.91, 'doc-login': 0.30, 'conv-endpoints': 0.22, 'ep-reset': 0.10 },
      notice: {
        rerank: 'The login-flow doc was the closest by meaning, but it says nothing about flaky tests, so it scored low.'
      },
      outcome: 'The model treats the old note as a hint and runs test_login_rate_limit to see whether the clock causes this failure too.'
    },
    deploy: {
      label: 'Deploy to staging',
      request: 'Deploy the current main branch to staging.',
      keywords: ['deploy', 'staging', 'main'],
      vector: { 'proc-deploy': 0.88, 'ep-deploy': 0.80, 'staging-url': 0.74, 'deploy-window': 0.70 },
      rerank: { 'proc-deploy': 0.95, 'staging-url': 0.82, 'deploy-window': 0.66, 'ep-deploy': 0.61 },
      notice: {
        rerank: 'The failed-deploy note is left out, but its lesson is already step 2 of the deploy steps.'
      },
      outcome: 'The model follows the deploy steps and checks that today is an allowed day, instead of working the steps out again.'
    },
    oncall: {
      label: 'On-call rotation',
      request: 'Who is on call for payments this week?',
      keywords: ['on call', 'payments', 'week'],
      vector: { 'deploy-window': 0.24, 'conv-endpoints': 0.19, 'staging-url': 0.17, 'ep-deploy': 0.15 },
      rerank: { 'deploy-window': 0.08, 'conv-endpoints': 0.05, 'staging-url': 0.04, 'ep-deploy': 0.03 },
      notice: {
        candidates: 'Even the closest note scores only 0.24, because a search by meaning always returns something, and the one keyword match, "weekday", is a false match.'
      },
      outcome: 'With nothing about the rotation in its context, the model should say it does not know and offer to check the on-call schedule.'
    }
  };

  var STAGES = [
    { key: 'request', label: 'Request', role: 'user', actor: 'User' },
    { key: 'query', label: 'Build the search', role: 'runtime', actor: 'Your code' },
    { key: 'candidates', label: 'Search results', role: 'runtime', actor: 'Your code' },
    { key: 'filter', label: 'Filter', role: 'runtime', actor: 'Your code' },
    { key: 'rerank', label: 'Pick the best', role: 'runtime', actor: 'Your code' },
    { key: 'provenance', label: 'Check sources', role: 'runtime', actor: 'Your code' },
    { key: 'inject', label: 'Add to context', role: 'runtime', actor: 'Your code' },
    { key: 'model', label: 'Model answers', role: 'model', actor: 'Model' }
  ];

  // The write path: what one run asked to remember, and the sources the runtime trusts per key.
  var PROPOSALS = [
    { id: 'p1', key: 'test.fast', value: 'test-fast', text: 'Run make test-fast for quick auth checks. The full suite takes 12 minutes.', scope: 'project', source: 'commands run in this session', at: TODAY, unsupported: 'the claim about 12 minutes' },
    { id: 'p2', key: 'db.engine', value: 'MySQL', text: 'The project database is MySQL.', scope: 'project', source: 'read services/legacy-analytics/config.yml', at: TODAY },
    { id: 'p3', key: 'python.version', value: 'Python 3.12', text: 'The API was upgraded to Python 3.12 last week.', scope: 'project', source: 'a CI log line', at: TODAY },
    { id: 'p4', key: 'deploy.window', value: 'not on Fridays', text: 'Staging deploys are frozen on Fridays.', scope: 'project', source: 'user: "I think we freeze on Fridays?"', at: TODAY },
    { id: 'p5', key: 'staging.db_password', text: 'Staging database password: ••••••••', scope: 'project', source: 'read .env.staging', at: TODAY, secret: true }
  ];
  // What each trusted source actually shows (says), the value that supports, and the fact your code may store.
  var AUTHORITY = {
    'test.fast': { source: 'Makefile', says: 'test-fast: pytest tests/auth tests/unit', value: 'test-fast', fact: 'make test-fast runs only the auth and unit tests.' },
    'db.engine': { source: 'infra/db.tf', says: 'engine = "postgresql", version = "15"', value: 'PostgreSQL 15', fact: 'Project uses PostgreSQL 15.' },
    'python.version': { source: 'Dockerfile', says: 'FROM python:3.12-slim', value: 'Python 3.12', fact: 'The API runs on Python 3.12.' }
  };

  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
  function byId(store, id) { return store.filter(function (e) { return e.id === id; })[0]; }
  function hits(keywords, text) {
    return keywords.filter(function (k) {
      return new RegExp('\\b' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text);
    });
  }
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  function src(name) { return /^[A-Z][a-z]+file$/.test(name) ? 'the ' + name : name; }   // "the Makefile", "infra/db.tf"
  function count(n, one, many) { return (WORDS[n] || String(n)) + ' ' + (n === 1 ? one : many); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  var DECISION_LABEL = { accepted: 'accepted', rejected: 'rejected', replaces: 'replaces an old fact', unresolved: 'left open for a person', blocked: 'blocked', pending: 'waiting' };

  function memoryFile(store) {
    return store.filter(function (e) { return e.pinned && e.status === 'accepted'; })
      .map(function (e) { return { id: e.id, text: e.text, tokens: e.tokens }; });
  }

  function retrieve(key) {
    var p = PRESETS[key];
    if (!p) throw new Error('unknown preset: ' + key);
    var pool = STORE.filter(function (e) { return !e.pinned; });   // the memory file already carries pinned facts
    var candidates = [];
    pool.forEach(function (e) {
      var kw = hits(p.keywords, e.text);
      var vec = p.vector[e.id] != null ? p.vector[e.id] : null;
      if (kw.length || vec != null) candidates.push({ id: e.id, kw: kw, vec: vec, rerank: null, verdict: null });
    });
    candidates.sort(function (a, b) { return (b.vec || 0) - (a.vec || 0) || b.kw.length - a.kw.length; });

    candidates.forEach(function (c) {
      var e = byId(STORE, c.id);
      if (SCOPES.indexOf(e.scope) === -1) c.verdict = 'wrong scope';
      else if (e.status !== 'accepted') c.verdict = 'not accepted';
      else c.rerank = p.rerank[c.id] || 0;
    });
    var used = 0;
    var injected = [];
    candidates.filter(function (c) { return !c.verdict; })
      .sort(function (a, b) { return b.rerank - a.rerank; })
      .forEach(function (c) {
        var e = byId(STORE, c.id);
        if (c.rerank < THRESHOLD) { c.verdict = 'below threshold'; return; }
        if (used + e.tokens > BUDGET) { c.verdict = 'over budget'; return; }
        c.verdict = 'selected';
        used += e.tokens;
        var changed = SOURCE_CHANGED[e.source];
        var stale = Boolean(changed && changed > e.verified);
        injected.push({ id: e.id, type: e.type, text: e.text, source: e.source, verified: e.verified, tokens: e.tokens,
          stale: stale, note: stale ? e.source + ' changed on ' + changed + ', after this was last verified' : '' });
      });

    var file = memoryFile(STORE);
    var context = [
      { kind: 'runtime', label: 'System prompt', tokens: 900 },
      { kind: 'tool', label: 'Tool definitions', tokens: 800 },
      { kind: 'memfile', label: 'Memory file (always injected)', tokens: file.reduce(function (a, f) { return a + f.tokens; }, 0), items: file.map(function (f) { return f.text; }) }
    ];
    if (injected.length) context.push({ kind: 'retrieved', label: 'Retrieved for this request', tokens: used, items: injected });
    context.push({ kind: 'user', label: 'User: ' + p.request, tokens: 20 });
    return { key: key, request: p.request, keywords: p.keywords.slice(), candidates: candidates, injected: injected, used: used, context: context };
  }

  function label(id) { return byId(STORE, id).label; }

  var REASON = { 'wrong scope': 'it belongs to another service, not this project', 'not accepted': 'it was never confirmed' };

  function narrate(stage, r, p) {
    var filtered = r.candidates.filter(function (c) { return REASON[c.verdict]; });
    var passing = r.candidates.filter(function (c) { return c.rerank != null; });
    var bar = passing.filter(function (c) { return c.rerank >= THRESHOLD; }).length;
    var over = passing.filter(function (c) { return c.verdict === 'over budget'; }).length;
    var stale = r.injected.filter(function (i) { return i.stale; });
    var n = r.injected.length;
    switch (stage) {
      case 'request':
        return 'The request arrives, and the memory file is already in the context, because your code always includes it.';
      case 'query':
        return 'Your code turns the request into a search: keywords for exact matches, plus the meaning of the whole request for similar notes.';
      case 'candidates':
        return 'Keyword search finds ' + count(r.candidates.filter(function (c) { return c.kw.length; }).length, 'note', 'notes') +
          ', and the search by meaning returns the ' + WORDS[r.candidates.filter(function (c) { return c.vec != null; }).length] + ' closest.';
      case 'filter':
        if (!filtered.length) return 'Every result is about this project or this user and is confirmed, so nothing is removed.';
        return 'Your code removes ' + filtered.map(function (c) { return 'the ' + label(c.id) + ', because ' + REASON[c.verdict]; }).join(', and ') + '.';
      case 'rerank':
        return 'A second scoring step rates how well each note fits the request, and ' + (!bar ? 'none reaches the ' + THRESHOLD + ' bar.'
          : count(bar, 'note reaches', 'notes reach') + ' the ' + THRESHOLD + ' bar' + (over ? ', but only ' + WORDS[bar - over] + ' fit in the ' + BUDGET + ' tokens of room.' : '.'));
      case 'provenance':
        if (!n) return 'Nothing was picked, so there is nothing to check.';
        return stale.length
          ? 'Your code checks where each picked note came from, and finds that the ' + label(stale[0].id) + ' is out of date, because ' + stale[0].source + ' changed after it was last checked.'
          : 'Your code checks where ' + (n === 1 ? 'the picked note' : 'each picked note') + ' came from and when it was last checked, and ' + (n === 1 ? 'it is' : 'all of them are') + ' current.';
      case 'inject':
        return n ? 'Your code adds ' + count(n, 'note', 'notes') + ' to the context after the memory file, ' + (n === 1 ? 'tagged' : 'each tagged') + ' with its source and date.'
          : 'Nothing fits, so your code adds nothing, rather than filling the space with weak matches.';
      default:
        return p.outcome;
    }
  }

  // Write policy: block secrets; accept new facts an authoritative source confirms; on conflict, let the
  // authoritative source decide; with no such source, leave the conflict open. Never decide by timestamp.
  function decide(store, p) {
    var out = { checks: { privacy: 'pass', conflict: 'none', source: 'none the runtime can read' } };
    if (p.secret) {
      p.status = out.decision = 'blocked';
      out.checks.privacy = 'blocked: a credential';
      out.say = 'Your code refuses to store a password, because stored memory shows up later in contexts, logs, and traces.';
      return out;
    }
    var cur = store.filter(function (e) { return e.key === p.key && e.scope === p.scope && e.status === 'accepted'; })[0];
    var auth = AUTHORITY[p.key];
    if (auth) out.checks.source = auth.source + ': ' + auth.says;
    if (cur) {
      out.conflict = cur.id;
      out.checks.conflict = 'with "' + cur.text + '"';
    }
    if (!cur && auth && auth.value === p.value) {
      // Store only what the source shows, built from the evidence, never the proposal's own wording.
      store.push({ id: p.key.replace(/\W+/g, '-'), label: 'new fact', type: 'fact', key: p.key, value: auth.value, text: auth.fact, scope: p.scope, source: auth.source, verified: TODAY, status: 'accepted', tokens: 25 });
      p.status = out.decision = 'accepted';
      p.partial = Boolean(p.unsupported);
      out.evidence = auth;
      out.say = p.unsupported
        ? cap(src(auth.source)) + ' supports only part of the claim, so your code stores "' + auth.fact.replace(/\.$/, '') + '" and drops ' + p.unsupported + '.'
        : 'Nothing stored covers this yet and ' + src(auth.source) + ' confirms it, so your code stores the fact with ' + src(auth.source) + ' as its source.';
      return out;
    }
    if (cur && auth && auth.value === cur.value) {
      cur.verified = TODAY;
      p.status = out.decision = 'rejected';
      out.evidence = auth;
      out.say = 'The proposal contradicts a confirmed fact, and ' + src(auth.source) + ' backs the confirmed fact, so your code rejects the proposal even though it is newer.';
      return out;
    }
    if (cur && auth && auth.value === p.value) {
      var id = cur.id + '-2';
      cur.status = 'superseded';
      cur.supersededBy = id;
      store.push({ id: id, label: cur.label, type: 'fact', key: p.key, value: auth.value, text: auth.fact, scope: p.scope, source: auth.source, verified: TODAY, status: 'accepted', pinned: cur.pinned, tokens: cur.tokens, supersedes: cur.id });
      p.status = out.decision = 'replaces';
      out.evidence = auth;
      out.say = 'The proposal contradicts a confirmed fact, but ' + src(auth.source) + ' backs the new claim, so your code marks the old fact as replaced and keeps it as history.';
      return out;
    }
    p.status = out.decision = 'unresolved';
    out.say = (cur ? 'The proposal contradicts a confirmed fact and nothing' : 'Nothing') + ' your code can read settles it, so your code keeps both claims, keeps using the confirmed one, and asks a person.';
    return out;
  }

  function write() {
    var store = clone(STORE);
    var lane = PROPOSALS.map(function (p) { var q = clone(p); q.status = 'pending'; return q; });
    var steps = [];
    function snap(s) { s.store = clone(store); s.proposals = clone(lane); steps.push(s); }
    snap({ title: 'Proposals arrive', say: 'During the run, the model asked to remember five things, and your code queued each one as a proposal that nothing reads yet.' });
    lane.forEach(function (p, n) {
      var d = decide(store, p);
      snap({ proposal: p.id, decision: d.decision, evidence: d.evidence || null, conflict: d.conflict || null, checks: d.checks,
        title: 'Proposal ' + (n + 1) + ': ' + DECISION_LABEL[d.decision] + (p.partial ? ' in part' : ''), say: d.say });
    });
    snap({ title: 'The next memory file', file: memoryFile(store), say: 'Your code rebuilds the memory file for the next run, so that run sees Python 3.12, while the MySQL claim never entered memory.' });
    return { proposals: clone(PROPOSALS), steps: steps, final: store };
  }

  function build(key) {
    if (key === 'write') return write().steps;
    var r = retrieve(key);
    return STAGES.map(function (s, i) { return { stage: i, key: s.key, title: s.label, say: narrate(s.key, r, PRESETS[key]) }; });
  }

  AC.sims['memory-sim'] = {
    store: STORE, presets: PRESETS, stages: STAGES, scopes: SCOPES, budget: BUDGET, threshold: THRESHOLD,
    sourceChanged: SOURCE_CHANGED, memoryFile: memoryFile, retrieve: retrieve, write: write, build: build
  };

  /* ---------- widget ---------- */

  var SCOPE_LABEL = { project: 'this project', user: 'this user', 'legacy-analytics': 'the analytics service' };
  var TYPE_LABEL = { fact: 'fact', episode: 'past task', doc: 'doc', procedure: 'how-to' };
  var MARK = {
    found: ['found', ''],
    'wrong scope': ['not this project', 'bad'],
    'not accepted': ['not confirmed', 'bad'],
    'below threshold': ['not relevant enough', 'mid'],
    'over budget': ['no room left', 'mid'],
    selected: ['picked', 'ok'],
    stale: ['out of date', 'mid'],
    'in context': ['in the context', 'ok'],
    'in context, stale': ['in the context, out of date', 'mid']
  };
  var DECISION_CLASS = { accepted: 'ok', replaces: 'ok', rejected: 'bad', blocked: 'bad', unresolved: 'mid', pending: '' };
  var BLOCK_LABEL = { runtime: 'Instructions', tool: 'Tool descriptions', memfile: 'Memory file (always included)', retrieved: 'Notes found for this request', user: 'The request' };
  var PILL = { runtime: 'your code', tool: 'tools', memfile: 'memory', retrieved: 'memory', user: 'user' };
  var PILL_ROLE = { runtime: 'runtime', tool: 'tool', memfile: 'state', retrieved: 'state', user: 'user' };

  function score(v) { return v == null ? 'not in the top four' : v.toFixed(2); }

  AC.widgets['memory-sim'] = function (root) {
    var h = AC.h;
    var keys = Object.keys(PRESETS).concat(['write']);
    var start = root.getAttribute('data-start');
    var current = keys.indexOf(start) !== -1 ? start : keys[0];
    var steps, res;
    function load() { steps = build(current); res = current === 'write' ? null : retrieve(current); }
    load();

    var frame = h('div', { class: 'w-frame ms' });
    frame.appendChild(h('div', { class: 'w-head' },
      h('p', { class: 'w-title', text: root.getAttribute('data-title') || 'How stored notes reach the model' }),
      h('p', { class: 'w-sub', text: 'Your code stores notes outside the model and adds only the useful ones to each call. Press Next to follow one request. Scores and dates are made up.' })));
    var body = h('div', { class: 'w-body' });
    frame.appendChild(body);

    var tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Example' });
    keys.forEach(function (k) {
      var b = h('button', { class: 'w-tab', type: 'button', 'data-key': k, text: k === 'write' ? 'Saving new memories' : PRESETS[k].label });
      b.addEventListener('click', function () {
        if (k === current) return;
        current = k;
        load();
        paintIntro();
        stepper.reset();
      });
      tabs.appendChild(b);
    });
    body.appendChild(tabs);

    var intro = h('p', { class: 'ms-intro' });
    body.appendChild(intro);
    var strip = h('ol', { class: 'ms-strip', 'aria-hidden': 'true' });
    STAGES.forEach(function (st, n) {
      strip.appendChild(h('li', null, h('span', { class: 'ms-stage ' + st.role, text: st.label }),
        n < STAGES.length - 1 ? h('span', { class: 'ms-arrow', text: '→' }) : null));
    });
    body.appendChild(strip);

    var panelA = h('div', { class: 'w-panel ms-panel' });
    var panelB = h('div', { class: 'w-panel ms-panel' });
    var details = h('div', { class: 'ms-details' });

    function paintIntro() {
      tabs.querySelectorAll('.w-tab').forEach(function (t) {
        var on = t.getAttribute('data-key') === current;
        t.setAttribute('aria-pressed', String(on));
        t.setAttribute('aria-pressed', String(on));
      });
      intro.textContent = '';
      if (current === 'write') {
        intro.appendChild(h('span', { class: 'badge runtime', text: 'Your code' }));
        intro.appendChild(document.createTextNode('A run has ended. Your code reviews the five things the model asked to remember.'));
      } else {
        intro.appendChild(h('span', { class: 'badge user', text: 'User' }));
        intro.appendChild(document.createTextNode(PRESETS[current].request));
      }
      strip.hidden = current === 'write';
    }

    function title(el, text) { el.appendChild(h('p', { class: 'ms-title', text: text })); }
    function rows(pairs) {
      var dl = h('dl', { class: 'ms-rows' });
      pairs.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', null, r[1])); });
      return dl;
    }
    function status(text, cls) { return h('span', { class: 'w-status ' + (cls || ''), text: text }); }
    // wideOnly: index of a column that is hidden on narrow screens.
    function table(head, body, wideOnly) {
      var cls = function (n) { return n === wideOnly ? 'ms-wide-only' : null; };
      var tb = h('tbody');
      body.forEach(function (r) { tb.appendChild(h('tr', null, r.map(function (c, n) { return h('td', { class: cls(n) }, c); }))); });
      return h('div', { class: 'ms-table-wrap' }, h('table', { class: 'ms-table' },
        h('thead', null, h('tr', null, head.map(function (c, n) { return h('th', { scope: 'col', class: cls(n), text: c }); }))), tb));
    }

    // An entry gets its provenance when it matters at this step; otherwise a compact row with the full text.
    function entry(e, mark, opts) {
      opts = opts || {};
      var cls = 'ms-entry' + (opts.hl ? ' is-hl' : '') + (opts.dim ? ' is-dim' : '') + (e.status === 'superseded' ? ' is-old' : '');
      var pill = h('span', { class: 'w-pill state', text: TYPE_LABEL[e.type] || e.type });
      var badge = mark ? status(mark[0], mark[1]) : null;
      if (!opts.full) return h('li', { class: cls + ' is-compact' }, pill, badge, h('span', { class: 'ms-entry-line', text: e.text }));
      return h('li', { class: cls },
        h('div', { class: 'ms-entry-top' }, pill, badge),
        h('p', { class: 'ms-entry-text', text: e.text }),
        opts.meta ? h('p', { class: 'ms-entry-meta', text: 'From ' + e.source + ', about ' + (SCOPE_LABEL[e.scope] || e.scope) + (e.verified ? ', last checked ' + e.verified : ', never checked') }) : null);
    }

    /* ----- retrieval ----- */

    function storeMark(e, c, stage) {
      if (e.pinned || !c || stage < 2) return null;
      var removed = c.verdict === 'wrong scope' || c.verdict === 'not accepted';
      if (stage < 3) return MARK.found;
      if (removed) return MARK[c.verdict];
      if (stage < 4) return MARK.found;
      if (c.verdict !== 'selected') return MARK[c.verdict];
      var inj = res.injected.filter(function (i) { return i.id === e.id; })[0];
      if (stage >= 5 && inj.stale) return stage >= 6 ? MARK['in context, stale'] : MARK.stale;
      return stage >= 6 ? MARK['in context'] : MARK.selected;
    }

    function paintStore(stage) {
      panelA.textContent = '';
      title(panelA, 'Stored outside the model');
      [['Always included: the memory file', function (e) { return e.pinned; }],
        ['Searched when needed', function (e) { return !e.pinned && e.status === 'accepted'; }],
        ['Proposed, not confirmed', function (e) { return e.status === 'proposed'; }]].forEach(function (g) {
        panelA.appendChild(h('p', { class: 'ms-group', text: g[0] }));
        var ul = h('ul', { class: 'ms-list' });
        STORE.filter(g[1]).forEach(function (e) {
          var c = res.candidates.filter(function (x) { return x.id === e.id; })[0];
          var removed = c && (c.verdict === 'wrong scope' || c.verdict === 'not accepted');
          var picked = c && c.verdict === 'selected';
          ul.appendChild(entry(e, storeMark(e, c, stage), {
            full: Boolean(c && stage >= 2),
            meta: Boolean((removed && stage === 3) || (picked && stage >= 5)),
            dim: stage >= 2 && !c && !e.pinned,
            hl: Boolean(picked && stage >= 4)
          }));
        });
        panelA.appendChild(ul);
      });
    }

    function paintContext(stage) {
      panelB.textContent = '';
      title(panelB, 'What the model sees on this call');
      var ol = h('ol', { class: 'ms-ctx' });
      var total = 0;
      res.context.forEach(function (b) {
        if (b.kind === 'retrieved' && stage < 6) return;
        total += b.tokens;
        if (b.kind === 'user' && stage < 6) ol.appendChild(h('li', { class: 'ms-ctx-pending', text: 'Notes found for this request will go here.' }));
        var li = h('li', { class: 'ms-ctx-block' + (b.kind === 'retrieved' ? ' is-new' : '') },
          h('div', { class: 'ms-ctx-head' },
            h('span', { class: 'w-pill ' + PILL_ROLE[b.kind], text: PILL[b.kind] }),
            h('span', { class: 'ms-ctx-label', text: BLOCK_LABEL[b.kind] })));
        if (b.kind === 'memfile') li.appendChild(h('ul', { class: 'ms-ctx-items' }, b.items.map(function (t) { return h('li', { text: t }); })));
        if (b.kind === 'retrieved') {
          li.appendChild(h('ul', { class: 'ms-ctx-items' }, b.items.map(function (i) {
            return h('li', null, i.text, h('span', { class: 'ms-tag', text: ' (from ' + i.source + ', checked ' + i.verified + (i.stale ? '; out of date, check before use' : '') + ')' }));
          })));
        }
        if (b.kind === 'user') li.appendChild(h('p', { class: 'ms-ctx-text', text: res.request }));
        ol.appendChild(li);
      });
      panelB.appendChild(ol);
      var memTokens = stage >= 6 ? res.used : 0;
      panelB.appendChild(h('p', { class: 'ms-ctx-total', text: 'About ' + AC.fmt(total) + ' tokens in total' + (memTokens ? ', ' + memTokens + ' of them from notes found for this request.' : '.') }));
      if (stage >= 6 && !res.injected.length) panelB.appendChild(h('p', { class: 'ms-note', text: 'No notes were added for this request.' }));
    }

    function paintDetails(stage) {
      details.textContent = '';
      var c = res.candidates;
      var key = STAGES[stage].key;
      title(details, 'Details for this step');
      var notice = PRESETS[current].notice && PRESETS[current].notice[key];
      if (notice) details.appendChild(h('p', { class: 'ms-notice' }, h('strong', { text: 'Worth noticing: ' }), notice));
      if (key === 'request') {
        details.appendChild(rows([['Searches only', 'notes about this project or this user'], ['Room for notes', BUDGET + ' tokens'], ['Lowest fit score kept', THRESHOLD + ', on a scale from 0 to 1']]));
      } else if (key === 'query') {
        details.appendChild(rows([
          ['Keywords', h('span', { class: 'ms-chips' }, res.keywords.map(function (k) { return h('code', { text: k }); }))],
          ['Meaning', 'the whole request, turned into a list of numbers so that similar texts get similar numbers'],
          ['Skipped', count(memoryFile(STORE).length, 'fact', 'facts') + ' already in the memory file']]));
      } else if (key === 'candidates') {
        var kw = c.filter(function (x) { return x.kw.length; }).sort(function (a, b) { return b.kw.length - a.kw.length; });
        var vec = c.filter(function (x) { return x.vec != null; });
        details.appendChild(h('div', { class: 'ms-two' },
          h('div', null, h('p', { class: 'ms-sub', text: 'Keyword matches' }),
            kw.length ? table(['Note', 'Matching words'], kw.map(function (x) { return [label(x.id), x.kw.join(', ')]; })) : h('p', { class: 'ms-note', text: 'No keyword matches.' })),
          h('div', null, h('p', { class: 'ms-sub', text: 'Closest by meaning' }),
            table(['Note', 'Similarity'], vec.map(function (x) { return [label(x.id), score(x.vec)]; })))));
      } else if (key === 'filter') {
        var removed = c.filter(function (x) { return REASON[x.verdict]; });
        details.appendChild(removed.length
          ? table(['Removed', 'Why'], removed.map(function (x) { return [label(x.id), REASON[x.verdict]]; }))
          : h('p', { class: 'ms-note', text: 'Nothing removed. Every result is about this project or this user, and confirmed.' }));
      } else if (key === 'rerank') {
        var ranked = c.filter(function (x) { return x.rerank != null; }).sort(function (a, b) { return b.rerank - a.rerank; });
        details.appendChild(table(['Note', 'Similarity', 'Fits the request', 'Size in tokens', 'Result'], ranked.map(function (x) {
          return [label(x.id), score(x.vec), score(x.rerank), String(byId(STORE, x.id).tokens), status(MARK[x.verdict][0], MARK[x.verdict][1])];
        }), 3));
        details.appendChild(h('div', { class: 'ms-budget' },
          h('span', { text: 'Room used: ' + res.used + ' of ' + BUDGET + ' tokens' }),
          h('div', { class: 'w-bar', 'aria-hidden': 'true' }, h('span', { class: 'w-seg state', style: { width: Math.min(100, 100 * res.used / BUDGET) + '%' } }))));
      } else if (key === 'provenance') {
        details.appendChild(res.injected.length
          ? table(['Note', 'Source', 'Last checked', 'Status'], res.injected.map(function (i) {
            return [label(i.id), i.source, i.verified, i.stale ? status('out of date', 'mid') : status('current', 'ok')];
          }), 1)
          : h('p', { class: 'ms-note', text: 'Nothing was picked.' }));
      } else if (key === 'inject') {
        details.appendChild(rows([['Memory file', 'always: ' + count(memoryFile(STORE).length, 'fact', 'facts')],
          ['Notes found', res.injected.length ? count(res.injected.length, 'note', 'notes') + ', using ' + res.used + ' of ' + BUDGET + ' tokens' : 'none']]));
      } else {
        var top = c.filter(function (x) { return x.vec != null; }).sort(function (a, b) { return b.vec - a.vec; })[0];
        var best = c.filter(function (x) { return x.rerank != null && x.rerank >= THRESHOLD; }).sort(function (a, b) { return b.rerank - a.rerank; })[0];
        var stale = res.injected.filter(function (i) { return i.stale; });
        details.appendChild(rows([
          ['Most similar', label(top.id) + (top.verdict === 'selected' ? ', used' : ', not used (' + MARK[top.verdict][0] + ')')],
          ['Most relevant', best ? label(best.id) : 'nothing passed the bar'],
          ['Maybe wrong', stale.length ? stale.map(function (i) { return label(i.id) + ', out of date'; }).join('; ') : 'nothing flagged']]));
      }
    }

    /* ----- saving new memories ----- */

    function paintWrite(st) {
      details.textContent = '';
      panelA.textContent = '';
      panelB.textContent = '';
      var p = st.proposal ? st.proposals.filter(function (x) { return x.id === st.proposal; })[0] : null;
      title(panelA, 'Stored facts');
      var touched = [st.conflict, st.conflict ? st.conflict + '-2' : null];
      var ul = h('ul', { class: 'ms-list' });
      st.store.filter(function (e) { return e.type === 'fact' && e.status !== 'proposed'; }).forEach(function (e) {
        var isNew = !byId(STORE, e.id);
        var mark = e.status === 'superseded' ? ['replaced', 'mid'] : isNew ? ['new', 'ok'] : null;
        var hl = touched.indexOf(e.id) !== -1 || (isNew && st.decision === 'accepted' && p && e.key === p.key);
        ul.appendChild(entry(e, mark, { full: hl || isNew || e.status === 'superseded', meta: hl, hl: hl }));
      });
      panelA.appendChild(ul);

      title(panelB, 'Proposals from this run (not stored yet)');
      var lane = h('ul', { class: 'ms-list' });
      st.proposals.forEach(function (q) {
        lane.appendChild(h('li', { class: 'ms-entry' + (q.id === st.proposal ? ' is-hl' : '') },
          h('div', { class: 'ms-entry-top' }, h('span', { class: 'w-pill model', text: 'proposal' }), status(DECISION_LABEL[q.status] + (q.partial ? ' in part' : ''), DECISION_CLASS[q.status])),
          h('p', { class: 'ms-entry-text', text: q.text }),
          h('p', { class: 'ms-entry-meta', text: 'Came from: ' + q.source })));
      });
      panelB.appendChild(lane);

      if (p) {
        title(details, 'Checks for this proposal');
        details.appendChild(rows([['Password or secret?', st.checks.privacy === 'pass' ? 'no' : 'yes, so it is blocked'],
          ['Conflicts with', st.checks.conflict === 'none' ? 'nothing stored' : st.checks.conflict.replace(/^with /, '')],
          ['Trusted source says', st.checks.source], ['Decision', status(DECISION_LABEL[st.decision] + (p.partial ? ' in part' : ''), DECISION_CLASS[st.decision])]]));
      } else if (st.file) {
        title(details, 'Memory file for the next run');
        details.appendChild(h('ul', { class: 'ms-ctx-items' }, st.file.map(function (f) { return h('li', { text: f.text }); })));
      } else {
        title(details, 'The rules your code applies');
        details.appendChild(h('ul', { class: 'ms-rules' },
          h('li', { text: 'Never save passwords or other secrets.' }),
          h('li', { text: 'Accept a new fact only when a trusted source confirms it.' }),
          h('li', { text: 'When a proposal contradicts a saved fact, let the trusted source decide, not the date.' }),
          h('li', { text: 'When no source can decide, keep both claims and ask a person.' })));
      }
    }

    function render(i, narration) {
      var st = steps[i];
      var stage = current === 'write' ? null : STAGES[st.stage];
      narration.appendChild(h('p', { class: 'ms-say' },
        h('span', { class: 'badge ' + (stage ? stage.role : 'runtime'), text: stage ? stage.actor : 'Your code' }),
        h('span', { class: 'w-step-title', text: st.title + '. ' }), st.say));
      if (current === 'write') { paintWrite(st); return; }
      strip.querySelectorAll('.ms-stage').forEach(function (el, n) {
        el.classList.toggle('is-active', n === st.stage);
        el.classList.toggle('is-done', n < st.stage);
      });
      paintStore(st.stage);
      paintContext(st.stage);
      paintDetails(st.stage);
    }

    var stepper = AC.stepper({ count: function () { return steps.length; }, render: render });
    body.appendChild(stepper.el);
    body.appendChild(h('div', { class: 'w-grid cols-2 ms-grid' }, panelA, panelB));
    body.appendChild(details);
    root.appendChild(frame);
    paintIntro();
    stepper.go(0);
  };
})();
