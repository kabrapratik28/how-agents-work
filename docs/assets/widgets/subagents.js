/* Subagent simulator (chapter 07). A parent agent delegates research on three job queues to three child loops.
   AC.sims.subagents.run(opts) computes every call, the tokens, the timing, the parent's context and the outcome
   for one configuration. It is pure and tested by tools/sims/subagents.test.mjs. Sizes and times are illustrative. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  // Illustrative sizes in tokens and times in seconds.
  var P = {
    parentPrefix: 2700,  // system prompt + tool definitions (with delegate) + AGENTS.md
    childPrefix: 2400,   // the child's own prompt + the tools it inherits + AGENTS.md
    singlePrefix: 2600,  // one agent with the same tools and no delegate tool
    request: 40, callOut: 60, brief: 240, wrap: 20, answer: 260, failNote: 40,
    modelSec: 12, finalSec: 15, planSec: 15, mergeSec: 20
  };
  var TOOL_SEC = { read_file: 1, search_docs: 5, read_docs: 20, write_file: 1, edit_file: 1, run_command: 8, timeout: 30 };
  var ORDER = ['redis', 'rabbitmq', 'sqs'];
  var BUDGET = { steps: 16, seconds: 360, errors: 3 }; // what each child's contract allows; your code enforces it
  var REQUEST = 'Pick a job queue for our background jobs: Redis Streams, RabbitMQ, or SQS.';

  var SCENARIOS = [
    { key: 'clean', label: 'Clean run' },
    { key: 'failure', label: 'A child fails' },
    { key: 'coupled', label: 'Two edit one file' },
    { key: 'disagree', label: 'They disagree' },
    { key: 'lost', label: 'A detail gets lost' }
  ];

  var FILES = {
    readme: ['app/jobs/README.md', 600, 'Background jobs: password-reset emails and Stripe webhooks. Peak about 40 a minute. A job may be retried.'],
    cache: ['infra/elasticache.tf', 450, 'Our Redis is a cache: maxmemory-policy = "allkeys-lru" (line 14), snapshot_retention_limit = 0 (line 21).'],
    main: ['infra/main.tf', 500, 'AWS: VPC, ECS services, RDS PostgreSQL. No message broker runs today.'],
    compose: ['docker-compose.yml', 400, 'Local services: api, postgres, redis.'],
    settings: ['app/settings.py', 150, 'JOB_QUEUE_URL = ""  # not set yet']
  };
  function read(key, text) { var f = FILES[key]; return { tool: 'read_file', arg: f[0], tokens: f[1], text: text || f[2], rediscovery: true }; }
  function docs(tool, arg, tokens, text) { return { tool: tool, arg: arg, tokens: tokens, text: text }; }
  function notes(id) { return { tool: 'write_file', arg: 'notes/queue-' + id + '.md', tokens: 20, out: 450, text: 'Wrote notes/queue-' + id + '.md (full findings)' }; }

  var CHILDREN = {
    redis: { label: 'Redis Streams', short: 'Redis', url: 'redis://cache:6379/1' },
    rabbitmq: { label: 'RabbitMQ', short: 'RabbitMQ', url: 'amqp://mq:5672' },
    sqs: { label: 'Amazon SQS', short: 'SQS', url: 'from the environment' }
  };

  var RESEARCH = {
    redis: [read('readme'), read('cache'),
      docs('search_docs', 'Redis Streams consumer groups and acks', 700, 'Hits: Streams overview, XREADGROUP, XACK, XAUTOCLAIM, persistence.'),
      docs('read_docs', 'Redis docs: Streams', 1800, 'Consumer groups track delivered entries. XACK clears them from the pending list. XAUTOCLAIM hands stuck entries to another consumer.'),
      docs('read_docs', 'Redis docs: persistence', 1500, 'Without AOF or RDB snapshots, data held in memory is lost on restart.')],
    rabbitmq: [read('readme'), read('compose'), read('main'),
      docs('search_docs', 'RabbitMQ acks and durable queues', 700, 'Hits: consumer acks, publisher confirms, quorum queues, dead lettering.'),
      docs('read_docs', 'RabbitMQ docs: confirms and acks', 1800, 'Consumer acks plus publisher confirms give at-least-once delivery.'),
      docs('read_docs', 'RabbitMQ docs: quorum queues', 1800, 'Quorum queues replicate messages across nodes for durability.'),
      docs('read_docs', 'RabbitMQ docs: dead lettering', 1200, 'Rejected or expired messages can go to a dead-letter exchange.')],
    sqs: [read('readme'), read('main'),
      docs('search_docs', 'SQS delivery, visibility timeout, dead-letter queues', 700, 'Hits: standard queues, visibility timeout, dead-letter queues, FIFO queues.'),
      docs('read_docs', 'AWS docs: SQS standard queues', 1600, 'At-least-once delivery, best-effort order. A received message stays hidden until it is deleted or its visibility timeout ends.'),
      docs('read_docs', 'AWS docs: SQS dead-letter queues', 1200, 'After a set number of receives, a message moves to a dead-letter queue.')]
  };
  var FIFO_DOCS = docs('read_docs', 'AWS docs: SQS FIFO queues', 1500, 'FIFO queues offer exactly-once processing: a message sent again within the 5-minute deduplication interval is not added twice.');

  var REPORTS = {
    full: {
      redis: 'Redis Streams: consumer groups, XACK and XAUTOCLAIM give at-least-once delivery. Risk: our Redis is a cache (allkeys-lru eviction, snapshots off: infra/elasticache.tf:14, :21), so queued jobs can be evicted or lost on restart. It would need a separate Redis with persistence. Notes: notes/queue-redis.md.',
      rabbitmq: 'RabbitMQ: acks plus publisher confirms give at-least-once delivery; quorum queues for durability; a dead-letter exchange sets aside jobs that keep failing. Cost: a new broker to run and monitor (none in infra/main.tf). Notes: notes/queue-rabbitmq.md.',
      sqs: 'SQS: managed by AWS, where we already run (infra/main.tf). Standard queues give at-least-once delivery with best-effort order. A received job comes back if the worker does not finish it in time (the visibility timeout), and a dead-letter queue sets aside jobs that keep failing. Consumers must be idempotent. Notes: notes/queue-sqs.md.'
    },
    short: {
      redis: 'Redis Streams: consumer groups, XACK and XAUTOCLAIM give at-least-once delivery. Already in our stack, so the least new infrastructure.',
      rabbitmq: 'RabbitMQ: at-least-once delivery with acks and confirms, quorum queues, and a place to set aside failing jobs. A new broker to run.',
      sqs: 'SQS: managed on AWS, at-least-once delivery, and a dead-letter queue for jobs that keep failing. Consumers must be idempotent.'
    },
    dupes: ' Duplicates: possible with any queue. A worker can crash after sending the email and before it acks, so consumers must be idempotent.',
    fifo: 'SQS: managed by AWS, where we already run. Use a FIFO queue: it gives exactly-once processing, so duplicate emails cannot happen. Notes: notes/queue-sqs.md.'
  };
  var REPORT_TOKENS = { full: 340, short: 150, dupes: 380 };

  var ANSWERS = {
    clean: 'Recommend SQS: a standard queue, plus a dead-letter queue where jobs that keep failing are set aside for a person to check. It is managed on AWS, where we already run. Delivery is at least once, so consumers must be idempotent. Redis Streams would need a separate Redis with persistence, because ours is a cache. RabbitMQ adds a broker to run.',
    lostWrong: 'Recommend Redis Streams. It is already in our stack, so it adds the least new infrastructure. Make consumers idempotent.',
    partial: 'Recommend RabbitMQ: quorum queues, a place to set aside failing jobs, and no eviction risk. Redis Streams would need a separate persistent Redis. SQS was not evaluated, because its research failed.',
    conflict: 'All three test scripts pass. Recommend SQS: managed on AWS, where we already run, with idempotent consumers.',
    owned: 'Recommend SQS. I set JOB_QUEUE_URL for SQS in app/settings.py. Each test script reads the URL from the environment, and all three pass.',
    confident: 'Recommend an SQS FIFO queue. Exactly-once processing means no duplicate emails, so consumers need no idempotency.',
    vote: 'Recommend SQS with idempotent consumers: two reports out of three say duplicates are possible.',
    evidence: 'Recommend SQS with idempotent consumers (one key per email). The verifier showed both sides were partly right: FIFO drops repeated sends within its 5-minute window, but a worker that crashes after sending and before deleting gets the message again.'
  };

  function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
  function sum(list, f) { return list.reduce(function (t, x) { return t + (f ? f(x) : x); }, 0); }
  function stepSec(st) { return P.modelSec + TOOL_SEC[st.timeout ? 'timeout' : st.tool]; }

  // The steps one child takes in one attempt.
  function childSteps(id, sc, o, attempt) {
    var steps = RESEARCH[id].slice();
    if (sc === 'failure' && id === 'sqs' && attempt === 1) {
      var t = { tool: 'read_docs', arg: 'AWS docs: SQS standard queues', tokens: 30, text: 'Error: read_docs timed out after 30 s', timeout: true };
      return steps.slice(0, 3).concat([t, t, t]);
    }
    if (sc === 'disagree' && id === 'sqs') steps.push(FIFO_DOCS);
    if (sc === 'coupled') steps = spike(id, steps, o);
    steps.push(notes(id));
    return steps;
  }

  // Coupled edits: each child also writes a small test script, and Redis and RabbitMQ both want JOB_QUEUE_URL in app/settings.py.
  function spike(id, steps, o) {
    var c = CHILDREN[id];
    var path = 'spikes/' + id + '/spike.py';
    var write = { tool: 'write_file', arg: path, tokens: 20, out: 300, text: 'Wrote ' + path };
    var runSpike = { tool: 'run_command', arg: 'python ' + path, tokens: 60, text: 'Enqueued 1 job, consumed 1 job: OK' };
    if (id === 'sqs') return steps.concat([write, runSpike]);
    var edit = { tool: 'edit_file', arg: 'app/settings.py', tokens: 20, out: 80, text: 'Edited app/settings.py', write: c.url };
    var early = read('settings', o.schedule === 'sequential' && id === 'rabbitmq' ? 'JOB_QUEUE_URL = "' + CHILDREN.redis.url + '"' : null);
    var out = [steps[0], early].concat(steps.slice(1));
    if (o.ownership) {
      runSpike = { tool: 'run_command', arg: 'JOB_QUEUE_URL=' + c.url + ' python ' + path, tokens: 60, text: 'Enqueued 1 job, consumed 1 job: OK' };
      var refused = { tool: 'edit_file', arg: 'app/settings.py', tokens: 40, out: 80, refused: true,
        text: 'Refused by the runtime: app/settings.py is outside your owned paths (spikes/' + id + '/, notes/queue-' + id + '.md).' };
      return out.concat([refused, write, runSpike]);
    }
    if (id === 'rabbitmq' && o.schedule !== 'sequential') {
      var stale = { tool: 'edit_file', arg: 'app/settings.py', tokens: 40, out: 80, text: 'Edit failed: the old text was not found. The file changed since you read it.' };
      var reread = read('settings', 'JOB_QUEUE_URL = "' + CHILDREN.redis.url + '"');
      reread.rediscovery = false;
      return out.concat([stale, reread, edit, write, runSpike]);
    }
    return out.concat([edit, write, runSpike]);
  }

  // Run one child loop: every call re-sends the child's prompt, its brief, and its history so far.
  // Your code enforces the contract's limits: the step budget, the time budget, and tool errors in a row.
  function runChild(id, attempt, steps, brief, report, start, prefix, budget) {
    var entries = [];
    var transcript = [{ id: id + '.' + attempt + ':brief', kind: 'brief', text: 'Brief: ' + brief.text, tokens: brief.tokens }];
    var calls = [];
    var acc = { prefixes: 0, briefs: 0, rediscovery: 0, work: 0 };
    var writes = [];
    var t = start;
    var n = 0;
    var rereads = 0;
    var errorsInRow = 0;
    var stop = null;
    function call(purpose, out, sec) {
      var hist = sum(entries, function (e) { return e.tokens; });
      var red = sum(entries.filter(function (e) { return e.rediscovery; }), function (e) { return e.tokens; });
      var c = { purpose: purpose, input: prefix + brief.tokens + hist, output: out, start: t, end: t + sec };
      acc.prefixes += prefix;
      acc.briefs += brief.tokens;
      acc.rediscovery += red;
      acc.work += hist - red + out;
      calls.push(c);
      t = c.end;
      return c;
    }
    function outOfBudget() { return calls.length >= budget.steps || t - start >= budget.seconds; }
    for (var i = 0; i < steps.length && !stop; i++) {
      var st = steps[i];
      if (outOfBudget()) { stop = 'budget'; break; }
      var out = st.out || P.callOut;
      call(st.tool + '(' + st.arg + ')', out, stepSec(st));
      if (st.write) writes.push({ by: id, value: st.write, at: t });
      if (st.rediscovery) rereads += 1;
      entries.push({ tokens: out, rediscovery: !!st.rediscovery });
      entries.push({ tokens: st.tokens, rediscovery: !!st.rediscovery });
      n += 1;
      transcript.push({ id: id + '.' + attempt + ':' + n + 'c', kind: 'call', text: st.tool + '(' + st.arg + ')', tokens: out });
      transcript.push({ id: id + '.' + attempt + ':' + n + 'r', kind: 'result', text: st.text, tokens: st.tokens });
      errorsInRow = st.timeout ? errorsInRow + 1 : 0;
      if (errorsInRow >= budget.errors) stop = 'errors';
    }
    if (!stop && outOfBudget()) stop = 'budget'; // no room left for the final report
    var status = stop === 'errors' ? 'failed' : stop === 'budget' ? 'budget' : 'done';
    var reportId = id + '.' + attempt + ':' + (status === 'done' ? 'report' : status);
    if (status === 'failed') {
      transcript.push({ id: reportId, kind: 'failed', text: 'Failed after ' + calls.length + ' steps: ' + budget.errors + ' tool errors in a row, so the loop stopped on its error rule. No report.', tokens: P.failNote });
    } else if (status === 'budget') {
      transcript.push({ id: reportId, kind: 'failed', text: 'Stopped after ' + calls.length + ' steps: its budget of ' + budget.steps + ' steps and ' + Math.round(budget.seconds / 60) + ' minutes ran out. No report.', tokens: P.failNote });
    } else {
      call('final report', report.tokens, P.finalSec);
      transcript.push({ id: reportId, kind: 'report', text: report.text, tokens: report.tokens });
    }
    return {
      attempt: attempt, status: status, calls: calls, transcript: transcript, reportId: reportId,
      reportText: transcript[transcript.length - 1].text, reportTokens: transcript[transcript.length - 1].tokens,
      start: start, end: t, acc: acc, writes: writes, rereads: rereads, returned: false
    };
  }

  function contractFor(id, sc, o, budget) {
    var c = CHILDREN[id];
    var shortOut = sc === 'lost' && !o.refs;
    var tools = ['search_docs', 'read_docs', 'read_file', 'write_file (notes only)'];
    var objective = 'Find out whether ' + c.label + ' fits our background jobs (emails and webhooks).';
    var owns = 'notes/queue-' + id + '.md';
    if (sc === 'coupled') {
      objective += ' Add a small test script under spikes/' + id + '/ that sends and receives one job.';
      tools = ['search_docs', 'read_docs', 'read_file', 'write_file', 'edit_file', 'run_command'];
      owns = 'spikes/' + id + '/, notes/queue-' + id + '.md' + (o.ownership ? ' (your code enforces this)' : ' (only written in the brief)');
    }
    if (sc === 'disagree') objective += ' Say whether duplicate jobs can happen.';
    return {
      child: id, label: c.label, objective: objective, tools: tools,
      output: shortOut ? 'A short summary, at most 150 tokens' : 'At most 350 tokens: how well it fits, risks with file and line, where the notes are',
      budget: budget.steps + ' steps and ' + Math.round(budget.seconds / 60) + ' minutes; ' + budget.errors + ' tool errors in a row end the run',
      owns: owns,
      cancel: 'The parent can stop it. Notes written so far stay.'
    };
  }

  function reportFor(id, sc, o) {
    if (sc === 'disagree') {
      if (id === 'sqs') return { text: REPORTS.fifo, tokens: REPORT_TOKENS.full };
      return { text: REPORTS.full[id] + REPORTS.dupes, tokens: REPORT_TOKENS.dupes };
    }
    var kind = sc === 'lost' && !o.refs ? 'short' : 'full';
    var text = REPORTS[kind][id];
    if (sc === 'coupled') text += o.ownership ? ' Test script passes. Setting needed: JOB_QUEUE_URL=' + CHILDREN[id].url + '.' : ' Test script passes.';
    return { text: text, tokens: REPORT_TOKENS[kind] };
  }

  // One agent doing the same work in one loop (for comparison). careful: notes plus cleared tool outputs.
  // It does each scenario's own steps, but none of the subagent overhead (no briefs, no stale or refused edits, no failed try).
  function baseline(careful, sc) {
    var plan = {};
    ORDER.forEach(function (id) {
      plan[id] = childSteps(id, sc === 'failure' ? 'clean' : sc, { schedule: 'sequential', ownership: false }, 2)
        .filter(function (st) { return !st.refused && !/^notes\//.test(st.arg); });
    });
    var base = P.singlePrefix + P.request;
    var hist = [];
    var calls = [];
    var secs = 0;
    function call(out, sec) {
      calls.push({ input: base + sum(hist, function (e) { return e.tokens; }), output: out });
      secs += sec;
    }
    var seen = {};
    ORDER.forEach(function (id) {
      plan[id].forEach(function (st) {
        if (!st.rediscovery || seen[st.arg]) return;
        seen[st.arg] = true;
        call(P.callOut, stepSec(st));
        hist.push({ tokens: P.callOut }, { tokens: st.tokens });
      });
    });
    ORDER.forEach(function (id) {
      var mine = [];
      plan[id].forEach(function (st) {
        if (st.rediscovery) return;
        call(P.callOut, stepSec(st));
        var r = { tokens: st.tokens };
        hist.push({ tokens: P.callOut }, r);
        mine.push(r);
      });
      if (careful) {
        var nt = notes(id);
        call(nt.out, stepSec(nt));
        hist.push({ tokens: nt.out }, { tokens: nt.tokens });
        mine.forEach(function (r) { r.tokens = 30; }); // cleared: a placeholder with a reference stays
      }
    });
    call(P.answer, P.mergeSec);
    return { tokens: sum(calls, function (c) { return c.input + c.output; }), wallClock: secs, lastContext: calls[calls.length - 1].input };
  }

  function run(opts) {
    var o = {
      scenario: (opts && opts.scenario) || 'clean',
      results: opts && opts.results === 'transcripts' ? 'transcripts' : 'summaries',
      schedule: opts && opts.schedule === 'sequential' ? 'sequential' : 'parallel',
      choice: opts && opts.choice,
      ownership: !!(opts && opts.ownership),
      refs: !!(opts && opts.refs)
    };
    var sc = o.scenario;
    if (sc !== 'coupled') o.ownership = false;
    if (sc !== 'lost') o.refs = false;
    var choices = { failure: ['retry', 'partial', 'ask'], disagree: ['confident', 'vote', 'evidence'] }[sc];
    var choice = choices && choices.indexOf(o.choice) !== -1 ? o.choice : null;
    var transcripts = o.results === 'transcripts';
    var parallel = o.schedule === 'parallel';
    var events = [];
    function ev(actor, label, text) { events.push({ actor: actor, label: label, text: text }); }

    // budgetSteps overrides the step budget; the tests use it to show the limit is enforced.
    var budget = { steps: (opts && opts.budgetSteps) || BUDGET.steps, seconds: BUDGET.seconds, errors: BUDGET.errors };
    var contracts = ORDER.map(function (id) { return contractFor(id, sc, o, budget); });
    var briefs = {};
    ORDER.forEach(function (id, i) {
      var k = contracts[i];
      briefs[id] = { text: k.objective + ' Tools: ' + k.tools.join(', ') + '. Output: ' + k.output + '. Budget: ' + k.budget + '. Owns: ' + k.owns + '.', tokens: P.brief };
    });

    // Parent call 1: plan and write three delegate calls.
    var parentCalls = [{ purpose: 'Writes the briefs', input: P.parentPrefix + P.request, output: 3 * (P.brief + P.wrap), start: 0, end: P.planSec }];
    ev('user', 'User', REQUEST);
    ev('parent', 'Parent', 'Writes three delegate calls, one brief each: one model call and ' + fmt(3 * P.brief) + ' tokens of briefs.');
    ev('runtime', 'Your code', (parallel ? 'Starts three child loops at once.' : 'Starts three child loops, one after another.') + ' Each starts fresh, with its own instructions and tools plus its brief, and nothing else from the parent.');

    // Children.
    var agents = { redis: [], rabbitmq: [], sqs: [] };
    var chains = [];
    var t0 = P.planSec;
    var cursor = t0;
    var humanWait = false;
    var waitingFailure = false;
    ORDER.forEach(function (id) {
      var start = parallel ? t0 : cursor;
      var r1 = runChild(id, 1, childSteps(id, sc, o, 1), briefs[id], reportFor(id, sc, o), start, P.childPrefix, budget);
      agents[id].push(r1);
      var last = r1;
      if (r1.status === 'failed') {
        if (choice === 'retry' || choice === 'ask') {
          if (choice === 'ask') humanWait = true;
          var r2 = runChild(id, 2, childSteps(id, sc, o, 2), briefs[id], reportFor(id, sc, o), r1.end, P.childPrefix, budget);
          agents[id].push(r2);
          last = r2;
        } else if (choice === 'partial') {
          r1.returned = true;
        } else {
          waitingFailure = true;
        }
      }
      if (last.status === 'done' || last.status === 'budget') last.returned = true;
      chains.push({ child: id, duration: last.end - start });
      cursor = last.end;
    });
    var phase = parallel ? Math.max.apply(null, chains.map(function (c) { return c.duration; })) : sum(chains, function (c) { return c.duration; });

    ORDER.forEach(function (id) {
      agents[id].forEach(function (r, k) {
        var c = CHILDREN[id];
        if (k > 0 && choice === 'ask') {
          ev('runtime', 'Your code', 'Pauses the run and asks you: the ' + c.short + ' child failed. Retry it, go on without it, or stop?');
          ev('human', 'You', 'Retry it. We run on AWS, so SQS matters.');
        } else if (k > 0) {
          ev('runtime', 'Your code', 'Its failure rule says retry once, so it starts a fresh ' + c.short + ' child with the same brief.');
        }
        var reads = r.rereads;
        var docsN = r.transcript.filter(function (e) { return e.kind === 'call' && /^read_docs|^search_docs/.test(e.text); }).length;
        var line = r.calls.length + ' model calls. ';
        if (r.status === 'failed') line += 'Its doc pages timed out 3 times in a row, so your code stopped its loop. Status: failed.';
        else if (r.status === 'budget') line += 'Its budget ran out before it finished, so your code sends back a note instead of a report.';
        else {
          line += 'Re-read ' + reads + ' file' + (reads === 1 ? '' : 's') + ' the parent already knew, and looked things up in the docs ' + docsN + ' times. ';
          line += transcripts ? 'Sends back its whole transcript (' + fmt(sum(r.transcript, function (e) { return e.tokens; })) + ' tokens).' : 'Sends back a ' + r.reportTokens + '-token report.';
        }
        ev('child', c.short + ' child' + (r.attempt > 1 ? ' (retry)' : ''), line);
        if (sc === 'coupled') {
          r.transcript.forEach(function (e) {
            if (/^Refused/.test(e.text)) ev('runtime', 'Your code', 'Refuses the ' + c.short + ' child\'s edit to app/settings.py, because that file is not on its list of files it may write.');
            if (/^Edit failed/.test(e.text)) ev('child', c.short + ' child', 'Its edit to app/settings.py fails: the file changed since it read it. It re-reads the file and overwrites the Redis value.');
          });
        }
      });
    });

    // Coupled edits: who wrote app/settings.py, and who lost.
    var files = { 'app/settings.py': { writes: [], final: '' } };
    ORDER.forEach(function (id) { agents[id].forEach(function (r) { files['app/settings.py'].writes = files['app/settings.py'].writes.concat(r.writes); }); });
    files['app/settings.py'].writes.sort(function (a, b) { return a.at - b.at; });
    var wsAll = files['app/settings.py'].writes;
    files['app/settings.py'].final = wsAll.length ? 'JOB_QUEUE_URL = "' + wsAll[wsAll.length - 1].value + '"' : FILES.settings[2];
    var conflict = null;
    var writers = [];
    files['app/settings.py'].writes.forEach(function (w) { if (writers.indexOf(w.by) === -1) writers.push(w.by); });
    if (writers.length >= 2) {
      var ws = files['app/settings.py'].writes;
      var winner = ws[ws.length - 1].by;
      conflict = { file: 'app/settings.py', writers: writers, winner: winner, broken: writers.filter(function (w) { return w !== winner; }) };
    }

    // Results go into the parent's context, in call order.
    var blocks = [
      { kind: 'prefix', label: 'Its instructions, tool definitions, and AGENTS.md', tokens: P.parentPrefix },
      { kind: 'user', label: 'User: ' + REQUEST, tokens: P.request }
    ];
    ORDER.forEach(function (id, i) {
      blocks.push({ kind: 'delegate', callId: 'call_' + (i + 1), label: 'delegate(' + CHILDREN[id].label + ') with its brief', tokens: P.brief + P.wrap });
    });
    // Transcript mode: the whole child transcript becomes the tool result. Summary mode: only the report (or the failure note).
    function resultBlock(cid, id, r) {
      var who = id === 'verifier' ? 'the verifier' : 'the ' + CHILDREN[id].short + ' child';
      if (transcripts) {
        return { kind: 'result', callId: cid, label: 'Full transcript from ' + who + ' (' + r.transcript.length + ' entries)',
          text: r.transcript.map(function (e) { return e.text; }).join('\n'), tokens: sum(r.transcript, function (e) { return e.tokens; }) + P.wrap,
          entries: r.transcript.map(function (e) { return e.id; }) };
      }
      return { kind: 'result', callId: cid, label: (r.status === 'failed' ? 'Failure note from ' : 'Report from ') + who,
        text: r.reportText, tokens: r.reportTokens + P.wrap, entries: [r.reportId] };
    }
    ORDER.forEach(function (id, i) {
      var cid = 'call_' + (i + 1);
      var r = agents[id].filter(function (x) { return x.returned; })[0];
      if (!r) { blocks.push({ kind: 'pending', callId: cid, label: 'No result yet from the ' + CHILDREN[id].short + ' child, which failed', tokens: 0 }); return; }
      blocks.push(resultBlock(cid, id, r));
    });
    if (!waitingFailure) ev('runtime', 'Your code', 'Puts ' + (transcripts ? 'every transcript' : 'the three reports') + ' into the parent\'s context as the results of its three calls (' + fmt(sum(blocks.filter(function (b) { return b.kind === 'result'; }), function (b) { return b.tokens; })) + ' tokens).');
    if (choice === 'partial') ev('runtime', 'Your code', 'Goes on without the SQS research and passes the failure note to the parent.');

    var ctxNow = function () { return sum(blocks, function (b) { return b.tokens; }); };
    var tEnd = t0 + phase;
    var segs = [{ agent: 'parent', label: 'Writes the briefs', start: 0, end: P.planSec, kind: 'parent' }];
    ORDER.forEach(function (id) {
      agents[id].forEach(function (r) { segs.push({ agent: id, label: r.status === 'failed' ? 'Failed try' : (r.attempt > 1 ? 'Second try' : 'Research'), start: r.start, end: r.end, kind: r.status === 'failed' ? 'failed' : 'child' }); });
    });
    var verifier = null;
    var disagreement = null;
    var lostDetail = null;
    var needsChoice = null;
    var outcome;
    var notesLine = '';

    function parentCall(purpose, out, sec) {
      var c = { purpose: purpose, input: ctxNow(), output: out, start: tEnd, end: tEnd + sec };
      parentCalls.push(c);
      segs.push({ agent: 'parent', label: purpose, start: c.start, end: c.end, kind: 'parent' });
      tEnd = c.end;
      return c;
    }

    if (sc === 'disagree') {
      disagreement = { claims: [
        { by: 'sqs', text: 'A FIFO queue gives exactly-once processing, so duplicate emails cannot happen.' },
        { by: 'redis', text: 'Duplicates are possible with any queue: a worker can crash after sending and before it acks.' },
        { by: 'rabbitmq', text: 'Duplicates are possible with any queue: consumers must be idempotent.' }
      ] };
    }

    if (waitingFailure) {
      needsChoice = { prompt: 'The SQS child failed. What should happen next?', options: [
        { key: 'retry', label: 'Retry it once' }, { key: 'partial', label: 'Go on with partial results' }, { key: 'ask', label: 'Ask the user' }] };
      outcome = { status: 'waiting', answer: '', notes: [] };
    } else if (sc === 'disagree' && !choice) {
      needsChoice = { prompt: 'The reports disagree about duplicates. How should the parent reconcile them?', options: [
        { key: 'confident', label: 'Trust the most confident report' }, { key: 'vote', label: 'Take a majority vote' }, { key: 'evidence', label: 'Check the evidence' }] };
      outcome = { status: 'waiting', answer: '', notes: [] };
    } else if (sc === 'disagree') {
      if (choice === 'evidence') {
        parentCall('Asks for a check', P.brief + P.wrap, P.modelSec);
        blocks.push({ kind: 'delegate', callId: 'call_4', label: 'delegate(verifier) with both claims', tokens: P.brief + P.wrap });
        var vSteps = [
          docs('read_docs', 'AWS docs: SQS FIFO queues', 1500, FIFO_DOCS.text),
          docs('read_docs', 'AWS docs: visibility timeout', 1300, 'A message that is received but not deleted becomes visible again when its visibility timeout ends.'),
          { tool: 'run_command', arg: 'crash test on a local queue emulator', tokens: 300, text: 'Sent 1 job. Worker sent the email, then crashed before deleting. Message redelivered after the timeout. Emails sent: 2.' }
        ];
        var vBrief = { text: 'Two reports disagree on duplicates with SQS FIFO. Check both claims against the primary docs, then run a crash test. Report what you observed.', tokens: 200 };
        verifier = runChild('verifier', 1, vSteps, vBrief, { text: 'Both partly right. FIFO deduplicates repeated sends within a 5-minute window. A worker that crashes after the side effect and before deleting gets the message again: 2 emails in the test. Consumers must be idempotent.', tokens: 260 }, tEnd, 1800, budget);
        verifier.returned = true;
        segs.push({ agent: 'verifier', label: 'Checks both claims', start: verifier.start, end: verifier.end, kind: 'child' });
        tEnd = verifier.end;
        blocks.push(resultBlock('call_4', 'verifier', verifier));
        ev('parent', 'Parent', 'Spots the conflict and delegates a check: read the primary docs, then run a crash test.');
        ev('child', 'Verifier child', verifier.calls.length + ' model calls. Emails sent in the crash test: 2. Both reports were partly right.');
      }
      parentCall('Combines the results', P.answer, P.mergeSec);
      if (choice === 'confident') {
        outcome = { status: 'risk', answer: ANSWERS.confident };
        notesLine = 'The confident report was wrong. If a worker crashes after sending the email but before deleting the message, SQS hands the message out again when the worker\'s time to finish runs out (the visibility timeout).';
      } else if (choice === 'vote') {
        outcome = { status: 'weak', answer: ANSWERS.vote };
        notesLine = 'Right answer, weak method. The children run the same model over similar pages, so their mistakes can be correlated. A vote is not evidence.';
      } else {
        outcome = { status: 'ok', answer: ANSWERS.evidence };
        notesLine = 'Checking the evidence cost a verifier run (' + fmt(sum(verifier.calls, function (c) { return c.input + c.output; })) + ' tokens) and settled the question.';
      }
      disagreement.resolution = choice;
    } else if (sc === 'coupled' && o.ownership) {
      parentCall('Combines, sets the one shared setting', 80, P.modelSec + TOOL_SEC.edit_file);
      blocks.push({ kind: 'tool', callId: 'call_4', label: 'edit_file(app/settings.py): JOB_QUEUE_URL for SQS', tokens: 80 + P.wrap });
      blocks.push({ kind: 'tool-result', callId: 'call_4', label: 'Edited app/settings.py', tokens: P.wrap });
      files['app/settings.py'].writes.push({ by: 'parent', value: 'SQS queue URL', at: tEnd });
      files['app/settings.py'].final = 'JOB_QUEUE_URL = os.environ["JOB_QUEUE_URL"]  # SQS in staging and production';
      ev('parent', 'Parent', 'Chooses SQS and makes the one shared change itself: JOB_QUEUE_URL in app/settings.py.');
      parentCall('Answers', P.answer, P.mergeSec);
      outcome = { status: 'ok', answer: ANSWERS.owned };
      notesLine = 'Your code refused the children\'s writes outside their own folders, so the parent made the one shared change, at the cost of one more call.';
    } else {
      parentCall('Combines the results', P.answer, P.mergeSec);
      var cutShort = ORDER.filter(function (id) { return agents[id][agents[id].length - 1].status === 'budget'; })
        .map(function (id) { return CHILDREN[id].short; });
      if (cutShort.length) {
        outcome = { status: 'partial', answer: 'I cannot recommend a queue yet: the ' + cutShort.join(' and ') + ' research stopped before it reported.' };
        notesLine = 'Your code stopped the ' + cutShort.join(' and ') + ' child when its step budget ran out, so the parent got a note instead of a report.';
      } else if (sc === 'coupled') {
        outcome = { status: 'conflict', answer: ANSWERS.conflict };
        notesLine = 'Two children edited app/settings.py, and the last write won. So the ' + CHILDREN[conflict.broken[0]].short + ' test script is broken, while its report still says it passed.';
      } else if (sc === 'failure' && choice === 'partial') {
        outcome = { status: 'partial', answer: ANSWERS.partial };
        notesLine = 'The failed attempt still cost ' + fmt(sum(agents.sqs[0].calls, function (c) { return c.input + c.output; })) + ' tokens. The answer has a gap: SQS runs on AWS, where you already are, and was never compared.';
      } else if (sc === 'failure') {
        outcome = { status: 'ok', answer: ANSWERS.clean };
        notesLine = choice === 'ask'
          ? 'The run waited for you. The time you take to answer is not in the wall-clock figure.'
          : 'The failed attempt cost ' + fmt(sum(agents.sqs[0].calls, function (c) { return c.input + c.output; })) + ' tokens, and the retry paid the full price again.';
      } else if (sc === 'lost') {
        var seen = /allkeys-lru/.test(blocks.map(function (b) { return b.label + ' ' + (b.text || ''); }).join('\n'));
        lostDetail = { detail: 'infra/elasticache.tf: maxmemory-policy = "allkeys-lru", snapshots off', inParentContext: seen };
        if (!seen) {
          outcome = { status: 'risk', answer: ANSWERS.lostWrong };
          notesLine = 'The Redis child read infra/elasticache.tf: allkeys-lru eviction, snapshots off. Its summary dropped it, so the parent picked a queue that can evict jobs.';
        } else if (transcripts && !o.refs) {
          outcome = { status: 'ok', answer: ANSWERS.clean };
          notesLine = 'The detail reached the parent inside ' + fmt(ctxNow()) + ' tokens of context. This run caught it. A detail buried that deep can still be missed.';
        } else {
          outcome = { status: 'ok', answer: ANSWERS.clean };
          notesLine = 'The contract asked for risks with file:line references, so the eviction risk survived the summary.';
        }
      } else {
        outcome = { status: 'ok', answer: ANSWERS.clean };
        notesLine = (parallel ? 'The children ran at the same time, so the answer came sooner' : 'The children ran one after another, so the answer took longer') +
          (transcripts ? ', and their whole transcripts filled the parent\'s context.' : ', and only three short reports reached the parent.');
      }
    }
    if (outcome.status !== 'waiting') {
      ev('parent', 'Parent', 'Answers: ' + outcome.answer);
      outcome.notes = [notesLine];
    } else {
      ev(sc === 'failure' ? 'runtime' : 'parent', sc === 'failure' ? 'Your code' : 'Parent', needsChoice.prompt + ' Waiting for your decision.');
    }

    // Accounting.
    var agentList = [{ id: 'parent', label: 'Parent', role: 'parent', runs: [{ attempt: 1, status: 'done', calls: parentCalls, transcript: [] }] }];
    ORDER.forEach(function (id) { agentList.push({ id: id, label: CHILDREN[id].label + ' child', role: 'child', runs: agents[id] }); });
    if (verifier) agentList.push({ id: 'verifier', label: 'Verifier', role: 'verifier', runs: [verifier] });
    var orchestration = sum(parentCalls, function (c) { return c.input + c.output; });
    var br = { orchestration: orchestration, prefixes: 0, briefs: 0, rediscovery: 0, work: 0 };
    var byAgent = { parent: orchestration };
    agentList.slice(1).forEach(function (a) {
      byAgent[a.id] = 0;
      a.runs.forEach(function (r) {
        ['prefixes', 'briefs', 'rediscovery', 'work'].forEach(function (k) { br[k] += r.acc[k]; });
        byAgent[a.id] += sum(r.calls, function (c) { return c.input + c.output; });
      });
    });
    var total = sum(agentList, function (a) { return sum(a.runs, function (r) { return sum(r.calls, function (c) { return c.input + c.output; }); }); });

    return {
      options: o,
      request: REQUEST,
      contracts: contracts,
      agents: agentList,
      parentContext: { blocks: blocks, tokens: ctxNow() },
      tokens: { total: total, orchestration: orchestration, byAgent: byAgent, breakdown: br },
      timing: {
        assumption: 'Each child step takes ' + (P.modelSec + 1) + ' to ' + (P.modelSec + TOOL_SEC.read_docs) + ' seconds, and children running at the same time never wait for each other (no shared rate limit).',
        chains: chains, childrenPhase: phase, wallClock: tEnd, humanWait: humanWait, segments: segs,
        slowest: chains.reduce(function (a, b) { return b.duration > a.duration ? b : a; }).child,
        sequentialPhase: sum(chains, function (c) { return c.duration; }),
        parallelPhase: Math.max.apply(null, chains.map(function (c) { return c.duration; }))
      },
      events: events,
      files: files,
      conflict: conflict,
      disagreement: disagreement,
      lostDetail: lostDetail,
      needsChoice: needsChoice,
      outcome: outcome,
      baselines: { naive: baseline(false, sc), careful: baseline(true, sc) }
    };
  }

  AC.sims['subagents'] = { scenarios: SCENARIOS, children: CHILDREN, order: ORDER, budget: BUDGET, run: run };

  /* ---------- widget ---------- */

  var STATUS = {
    ok: ['ok', 'Good answer'], risk: ['bad', 'Risky answer'], conflict: ['bad', 'A test script is broken'],
    partial: ['mid', 'Partial answer'], weak: ['mid', 'Right, but by luck'], waiting: ['mid', 'Waiting for your decision']
  };
  var CHOICE_LABEL = {
    retry: 'Retry it once', partial: 'Go on with partial results', ask: 'Ask the user',
    confident: 'Trust the most confident report', vote: 'Take a majority vote', evidence: 'Check the evidence'
  };
  var PILL = { prefix: ['runtime', 'your code'], user: ['user', 'user'], delegate: ['model', 'request'], tool: ['model', 'request'], result: ['tool', 'result'], 'tool-result': ['tool', 'result'], pending: ['', 'waiting'] };
  var KV = [['objective', 'Task'], ['tools', 'Tools'], ['output', 'Send back'], ['budget', 'Limits'], ['owns', 'May write'], ['cancel', 'If stopped']];

  function mins(sec) { return (sec / 60).toFixed(1) + ' min'; }

  AC.widgets['subagents'] = function (root) {
    var h = AC.h;
    var start = root.getAttribute('data-start');
    var st = { scenario: SCENARIOS.some(function (s) { return s.key === start; }) ? start : 'clean', results: 'summaries', schedule: 'parallel', choice: null, ownership: false, refs: false };

    var frame = h('div', { class: 'w-frame sa' });
    frame.appendChild(h('div', { class: 'w-head' },
      h('p', { class: 'w-title', text: root.getAttribute('data-title') || 'A parent delegates three tasks and receives the results' }),
      h('p', { class: 'w-sub', text: 'Times and token counts are illustrative.' })));
    var body = h('div', { class: 'w-body' });
    frame.appendChild(body);
    body.appendChild(h('p', { class: 'sa-request' }, h('span', { class: 'badge user', text: 'User' }), REQUEST));

    var tabs = h('div', { class: 'w-tabs', role: 'group', 'aria-label': 'Scenario' });
    SCENARIOS.forEach(function (s) {
      tabs.appendChild(h('button', { class: 'w-tab', type: 'button', 'data-key': s.key, 'aria-pressed': String(s.key === st.scenario), text: s.label,
        on: { click: function () {
          if (st.scenario === s.key) return;
          st.scenario = s.key; st.choice = null; st.ownership = false; st.refs = false;
          paint();
        } } }));
    });
    body.appendChild(tabs);

    function seg(label, key, options) {
      var group = h('div', { class: 'sa-group', role: 'group', 'aria-label': label }, h('span', { class: 'sa-group-label', 'aria-hidden': 'true', text: label }));
      options.forEach(function (op) {
        group.appendChild(h('button', { class: 'w-btn sa-seg', type: 'button', 'data-key': key, 'data-value': op[0], text: op[1],
          on: { click: function () { st[key] = op[0]; paint(); } } }));
      });
      return group;
    }
    body.appendChild(h('div', { class: 'sa-controls' },
      seg('What comes back:', 'results', [['summaries', 'Short reports'], ['transcripts', 'Full transcripts']]),
      seg('Children run:', 'schedule', [['parallel', 'At the same time'], ['sequential', 'One after another']])));

    // The scenario's own option lives in the narration box, so the first screen has only two toggles.
    var narration = h('div', { class: 'w-narration sa-narration', 'aria-live': 'polite' });
    var say = h('div');
    var optId = AC.uid('sa-opt');
    var optBox = h('input', { type: 'checkbox', id: optId, on: { change: function () {
      if (st.scenario === 'coupled') st.ownership = optBox.checked; else st.refs = optBox.checked;
      paint();
    } } });
    var optText = h('span');
    var optLabel = h('label', { class: 'w-toggle sa-opt', for: optId }, optBox, optText);
    narration.appendChild(say);
    narration.appendChild(optLabel);
    var picture = h('div', { class: 'sa-picture' });
    var story = h('div', { class: 'sa-story' });
    var details = h('details', { class: 'sa-more' }, h('summary', { text: 'Details' }));
    var tlBox = h('div', { class: 'sa-detail' });
    var ctxBox = h('div', { class: 'sa-detail' });
    var tokBox = h('div', { class: 'sa-detail' });
    var logBox = h('div', { class: 'sa-detail' });
    details.appendChild(h('div', { class: 'w-grid cols-2' }, tlBox, ctxBox));
    details.appendChild(h('div', { class: 'w-grid cols-2 sa-row' }, tokBox, logBox));
    body.appendChild(narration);
    body.appendChild(picture);
    body.appendChild(story);
    body.appendChild(details);
    root.appendChild(frame);

    function title(panel, text) { panel.textContent = ''; panel.appendChild(h('p', { class: 'w-panel-title', text: text })); }
    function badge(actor, label) {
      var cls = { user: 'user', parent: 'model', runtime: 'runtime', human: 'human' }[actor] || '';
      return h('span', { class: 'badge' + (cls ? ' ' + cls : ''), text: label });
    }

    function paintNarration(r) {
      var hadFocus = narration.contains(document.activeElement) ? document.activeElement.getAttribute('data-choice') : null;
      say.textContent = '';
      var o = r.options;
      var text = {
        clean: 'The parent writes one brief per queue. Each child researches its queue in its own loop and sends back a short report.',
        failure: 'The SQS child failed: its doc pages timed out three times in a row, so its loop stopped.',
        coupled: 'Each child also writes a small test script. Two of them change the same setting in app/settings.py.',
        disagree: 'The reports disagree. The SQS child says a FIFO queue makes duplicate emails impossible, and the other two say any queue can deliver twice.',
        lost: o.refs ? 'Now the brief also asks for risks, with the file and line where each one was found.' : 'The brief asks only for a short summary. Watch what the Redis child leaves out.'
      }[o.scenario];
      say.appendChild(h('p', { class: 'sa-say', text: text }));
      var opts = { failure: ['retry', 'partial', 'ask'], disagree: ['confident', 'vote', 'evidence'] }[o.scenario];
      if (!opts) return;
      say.appendChild(h('p', { class: 'sa-say sa-ask', text: o.scenario === 'failure' ? 'What should happen next?' : 'How should the parent settle it?' }));
      var box = h('div', { class: 'sa-choices', role: 'group', 'aria-label': 'Your decision' });
      opts.forEach(function (key) {
        box.appendChild(h('button', { class: 'w-btn' + (st.choice ? '' : ' primary'), type: 'button', 'data-choice': key, 'aria-pressed': String(st.choice === key), text: CHOICE_LABEL[key],
          on: { click: function () { st.choice = key; paint(); } } }));
      });
      say.appendChild(box);
      if (hadFocus) {
        var again = box.querySelector('[data-choice="' + hadFocus + '"]');
        if (again) again.focus();
      }
    }

    function childBox(r, c) {
      var runs = r.agents.filter(function (a) { return a.id === c.child; })[0].runs;
      var shown = runs.filter(function (x) { return x.returned; })[0] || runs[runs.length - 1];
      var status = runs.length > 1 ? ['mid', 'Failed, then retried'] : runs[0].status === 'failed' ? ['bad', 'Failed'] : ['ok', 'Done'];
      if (r.conflict && r.conflict.broken.indexOf(c.child) !== -1) status = ['bad', 'Its test broke later'];
      var chain = r.timing.chains.filter(function (x) { return x.child === c.child; })[0];
      var tTok = sum(shown.transcript, function (e) { return e.tokens; });
      var back;
      if (!shown.returned) back = 'Nothing yet';
      else if (r.options.results === 'transcripts') back = 'Its whole transcript: ' + fmt(tTok) + ' tokens';
      else back = shown.status === 'failed' ? 'A short failure note' : 'A short report: ' + fmt(shown.reportTokens) + ' tokens';
      var box = h('div', { class: 'sa-box sa-kid' },
        h('p', { class: 'sa-box-title' }, h('span', { text: c.label }), h('span', { class: 'w-status ' + status[0], text: status[1] })),
        h('p', { class: 'sa-box-line', text: 'Worked for ' + mins(chain.duration) }),
        h('p', { class: 'sa-back' }, h('span', { class: 'sa-back-label', text: 'Sends back: ' }), back));
      var dl = h('dl', { class: 'w-kv sa-kv' });
      KV.forEach(function (row) {
        dl.appendChild(h('dt', { text: row[1] }));
        dl.appendChild(h('dd', { text: row[0] === 'tools' ? c.tools.join(', ') : c[row[0]] }));
      });
      var ol = h('ol', { class: 'sa-entries' });
      shown.transcript.forEach(function (e) {
        ol.appendChild(h('li', { class: e.kind }, h('span', { class: 'sa-entry-text', text: e.text }), h('span', { class: 'sa-tok', text: fmt(e.tokens) })));
      });
      box.appendChild(h('details', { class: 'sa-small' }, h('summary', { text: 'Its brief and transcript' }), dl,
        h('p', { class: 'sa-small-title', text: 'Transcript' + (shown.attempt > 1 ? ' of the second try' : '') + ', ' + shown.transcript.length + ' entries:' }), ol));
      return box;
    }

    function paintPicture(r) {
      picture.textContent = '';
      picture.appendChild(h('div', { class: 'sa-box sa-parent' },
        h('p', { class: 'sa-box-title' }, h('span', { class: 'badge model', text: 'Parent' }), h('span', { text: 'Writes one brief per queue and hands each to a child' }))));
      picture.appendChild(h('p', { class: 'sa-arrow', 'aria-hidden': 'true', text: '↓' }));
      var kids = h('div', { class: 'sa-kids' });
      r.contracts.forEach(function (c) { kids.appendChild(childBox(r, c)); });
      picture.appendChild(kids);
      picture.appendChild(h('p', { class: 'sa-arrow sa-arrow-label', text: '↓ the results go back to the parent ↓' }));
      var s = STATUS[r.outcome.status];
      var ans = h('div', { class: 'sa-box sa-answer-box' },
        h('p', { class: 'sa-box-title' }, h('span', { text: r.outcome.status === 'waiting' ? 'The parent\'s answer' : 'The parent\'s answer, after ' + mins(r.timing.wallClock) }), h('span', { class: 'w-status ' + s[0], text: s[1] })));
      if (r.outcome.status === 'waiting') {
        ans.appendChild(h('p', { class: 'sa-box-line', text: 'No answer yet. Make the decision above.' }));
      } else {
        ans.appendChild(h('blockquote', { class: 'sa-answer', text: r.outcome.answer }));
        r.outcome.notes.forEach(function (n) { ans.appendChild(h('p', { class: 'sa-note', text: n })); });
        if (r.conflict) ans.appendChild(h('p', { class: 'w-warn', text: 'app/settings.py now says ' + r.files['app/settings.py'].final + '. It was written by the ' + r.conflict.writers.map(function (w) { return CHILDREN[w].short; }).join(' child, then the ') + ' child.' }));
      }
      picture.appendChild(ans);
    }

    function paintStory(r) {
      story.textContent = '';
      var parentTok = r.tokens.orchestration;
      var kidsTok = r.tokens.total - parentTok;
      var careful = r.baselines.careful.tokens;
      var scale = Math.max(r.tokens.total, careful) * 1.04;
      var waiting = r.outcome.status === 'waiting';
      story.appendChild(h('p', { class: 'sa-story-line', text: (waiting ? 'So far the agents have used ' : 'Together the agents used ') + fmt(r.tokens.total) + ' tokens, one careful agent would use ' + fmt(careful) + ', and the parent itself saw only ' + fmt(r.parentContext.tokens) + ' of them.' }));
      var bar = h('div', { class: 'sa-tokbar', role: 'img', 'aria-label': 'Tokens: the parent used ' + fmt(parentTok) + ', the children ' + fmt(kidsTok) + '. One careful agent would use ' + fmt(careful) + '.' },
        h('span', { class: 'sa-seg parent', style: { width: (100 * parentTok / scale) + '%' } }),
        h('span', { class: 'sa-seg kids', style: { width: (100 * kidsTok / scale) + '%' } }),
        h('span', { class: 'sa-mark', style: { left: (100 * careful / scale) + '%' } }));
      story.appendChild(bar);
      story.appendChild(h('p', { class: 'sa-legend', 'aria-hidden': 'true' },
        h('span', null, h('i', { class: 'sa-sw parent' }), 'the parent'),
        h('span', null, h('i', { class: 'sa-sw kids' }), 'the children'),
        h('span', null, h('i', { class: 'sa-sw mark' }), 'one careful agent')));
    }

    function paintTimeline(r) {
      title(tlBox, 'How the time adds up');
      var tm = r.timing;
      var wall = tm.wallClock;
      var rows = [['parent', 'Parent']].concat(ORDER.map(function (id) { return [id, CHILDREN[id].short]; }));
      if (tm.segments.some(function (s) { return s.agent === 'verifier'; })) rows.push(['verifier', 'Checker']);
      var box = h('div', { class: 'sa-tl', role: 'img', 'aria-label': 'Timeline. The run takes ' + mins(wall) + '.' });
      rows.forEach(function (row) {
        var track = h('div', { class: 'sa-track' });
        tm.segments.filter(function (s) { return s.agent === row[0]; }).forEach(function (s) {
          track.appendChild(h('span', { class: 'sa-bar ' + s.kind, title: s.label + ': ' + mins(s.start) + ' to ' + mins(s.end),
            style: { left: (100 * s.start / wall) + '%', width: Math.max(0.8, 100 * (s.end - s.start) / wall) + '%' } }));
        });
        box.appendChild(h('div', { class: 'sa-tl-row' }, h('span', { class: 'sa-tl-label', text: row[1] }), track));
      });
      var axis = h('div', { class: 'sa-track sa-axis', 'aria-hidden': 'true' });
      var step = wall > 600 ? 180 : wall > 240 ? 120 : 60;
      for (var t = 0; t <= wall; t += step) axis.appendChild(h('span', { class: t / wall > 0.85 ? 'end' : null, style: { left: (100 * t / wall) + '%' }, text: (t / 60) + (t ? ' min' : '') }));
      box.appendChild(h('div', { class: 'sa-tl-row' }, h('span', { class: 'sa-tl-label' }), axis));
      tlBox.appendChild(box);
      var slow = CHILDREN[tm.slowest].short;
      tlBox.appendChild(h('p', { class: 'sa-line', text: r.options.schedule === 'parallel'
        ? 'The children overlap, so their part takes as long as the slowest one (' + slow + '): ' + mins(tm.childrenPhase) + '. One after another would take ' + mins(tm.sequentialPhase) + '.'
        : 'The children run one after another, so their times add up: ' + mins(tm.childrenPhase) + '. At the same time would take ' + mins(tm.parallelPhase) + '.' }));
      if (tm.humanWait) tlBox.appendChild(h('p', { class: 'sa-line', text: 'This leaves out how long you took to answer.' }));
      tlBox.appendChild(h('p', { class: 'w-note', text: 'Assumes ' + tm.assumption.charAt(0).toLowerCase() + tm.assumption.slice(1) }));
    }

    function paintContext(r) {
      title(ctxBox, r.outcome.status === 'waiting' ? 'What the parent sees so far' : 'What the parent sees at the end');
      var ol = h('ol', { class: 'sa-ctx' });
      r.parentContext.blocks.forEach(function (b) {
        var p = PILL[b.kind] || ['', b.kind];
        ol.appendChild(h('li', { class: b.kind === 'pending' ? 'pending' : null },
          h('span', { class: 'w-pill ' + p[0], text: p[1] }), h('span', { class: 'sa-ctx-label', text: b.label }), h('span', { class: 'sa-tok', text: fmt(b.tokens) })));
      });
      ctxBox.appendChild(ol);
    }

    function paintTokens(r) {
      title(tokBox, 'Where the tokens went');
      var b = r.tokens.breakdown;
      var t1 = h('table', { class: 'sa-table' }, h('caption', { class: 'visually-hidden', text: 'Tokens used by every call of every agent' }));
      var tb = h('tbody');
      [['The parent\'s own calls: writing briefs, combining results', b.orchestration],
        ['Each child\'s instructions and tools, sent again on every child call', b.prefixes],
        ['The briefs, sent again on every child call', b.briefs],
        ['Children re-reading files the parent already knew', b.rediscovery],
        ['The research itself: docs, notes, reports', b.work]].forEach(function (row) {
        tb.appendChild(h('tr', null, h('th', { scope: 'row', text: row[0] }), h('td', { text: fmt(row[1]) })));
      });
      tb.appendChild(h('tr', { class: 'sa-total' }, h('th', { scope: 'row', text: 'Total' }), h('td', { text: fmt(r.tokens.total) })));
      t1.appendChild(tb);
      tokBox.appendChild(t1);
      var bl = r.baselines;
      tokBox.appendChild(h('p', { class: 'sa-line', text: 'One agent doing the same research takes ' + fmt(bl.careful.tokens) + ' tokens and ' + mins(bl.careful.wallClock) + ' if it saves notes and clears old tool output. It takes ' + fmt(bl.naive.tokens) + ' tokens and ' + mins(bl.naive.wallClock) + ' if it keeps its whole history.' }));
    }

    function paintLog(r) {
      title(logBox, 'What happened, step by step');
      var ol = h('ol', { class: 'w-log sa-log' });
      r.events.forEach(function (e) { ol.appendChild(h('li', null, badge(e.actor, e.label), e.text)); });
      logBox.appendChild(ol);
    }

    function paint() {
      var r = run(st);
      tabs.querySelectorAll('.w-tab').forEach(function (t) { t.setAttribute('aria-pressed', String(t.getAttribute('data-key') === st.scenario)); });
      body.querySelectorAll('.sa-seg').forEach(function (b) { b.setAttribute('aria-pressed', String(st[b.getAttribute('data-key')] === b.getAttribute('data-value'))); });
      optLabel.hidden = !(st.scenario === 'coupled' || st.scenario === 'lost');
      optText.textContent = st.scenario === 'coupled' ? 'Let your code block writes outside each child\'s own folder' : 'Ask for risks, with file and line, in the brief';
      optBox.checked = st.scenario === 'coupled' ? st.ownership : st.refs;
      paintNarration(r);
      paintPicture(r);
      paintStory(r);
      paintTimeline(r);
      paintContext(r);
      paintTokens(r);
      paintLog(r);
    }
    paint();
  };
})();
