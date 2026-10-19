/* Architecture explorer (chapter 14). Seven shapes in four situations. Each pair has a verdict
   (helps, neutral, hurts), a reason, an authored trace, and a picture of the shape whose parts light up
   one step at a time. The model-call count is derived from the trace, never typed in.
   AC.sims['architectures'] is pure and tested by tools/sims/architectures.test.mjs. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  /* ---------- trace steps ---------- */

  function step(actor, text, flag, who, extra) {
    var s = { actor: actor, text: text, flag: flag || null, who: who || null };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }
  function U(text) { return step('user', text); }
  function E(text, flag, extra) { return step('event', text, flag, null, extra); }
  function R(text, flag, extra) { return step('runtime', text, flag, null, extra); }
  function T(text, flag) { return step('tool', text, flag); }
  function H(text, extra) { return step('human', text, null, null, extra); }
  function M(who, text, flag, extra) { return step('model', text, flag, who, extra); }

  var ASK_FIND = 'Find every call to `parse_legacy_token()` in api, billing, and admin, and list them by file and line.';
  var ASK_HASH = 'Store session tokens hashed instead of in plain text.';
  var ASK_COLUMN = 'Add a `last_seen_at` column to sessions and update the shared staging database.';
  var CI_FAIL = '02:10. CI fails on main: `test_login_expired_token`.';
  var MIGRATE = 'Asks to run `alembic upgrade head` on staging.';
  var LIST = 'Lists 6 calls by file and line: 4 in api, 2 in admin, none in billing.';
  // Pending requests: an approval resumes only the exact request it was given for.
  var MIG = { id: 'req-0042', action: 'alembic upgrade head', target: 'staging' };
  var PR_CI = { id: 'req-pr-551', action: 'open pull request', target: 'branch fix-expired-token' };
  var PR_88 = { id: 'req-pr-88', action: 'open pull request', target: 'branch hash-session-tokens' };
  var ASK_DEV = 'Your code saves the exact pull request as a pending request and asks the developer to approve it.';
  var ASK_LATER = 'saves the exact pull request as a pending request, asks for approval, and the process exits.';
  var RECONCILE = 'Records op-0042 as done. Had the process crashed just before this, the next worker would find op-0042 marked attempted and check the database’s migration version instead of running the command again.';

  // One loop searches the three services in turn: 4 model calls.
  function search(who) {
    return [
      M(who, 'Asks to search api for `parse_legacy_token(`.'), T('api: 4 calls.'),
      M(who, 'Asks for the same search in billing.'), T('billing: no calls.'),
      M(who, 'Asks for the same search in admin.'), T('admin: 2 calls.'),
      M(who, LIST)
    ];
  }
  // Three parallel helpers, each a search and a summary: 6 model calls.
  function fanOut(prefix) {
    return [
      M(prefix + ' 1', 'Searches api.'), M(prefix + ' 2', 'Searches billing.'), M(prefix + ' 3', 'Searches admin.'),
      T('api: 4 calls. billing: none. admin: 2.'),
      M(prefix + ' 1', 'Summary: 4 calls, with file and line.'),
      M(prefix + ' 2', 'Summary: no calls in billing.'),
      M(prefix + ' 3', 'Summary: 2 calls, with file and line.')
    ];
  }
  function hashEdit(who) {
    return [
      M(who, 'Asks to read `auth/session.py`.'), T('`create_token()` and `is_valid()` both use plain tokens.'),
      M(who, 'Asks for one edit that changes both functions to SHA-256.'), T('Both changes applied.'),
      M(who, 'Asks to run the tests.'), T('12 passed.')
    ];
  }
  function nobodyStarts() {
    return [
      E(CI_FAIL),
      R('The alert lands in a chat channel. No loop is running, so nothing happens for seven hours.', 'delay', { at: 'start' }),
      H('09:05. A developer sees the alert and pastes it into Patch.')
    ];
  }
  // Every shape starts the fix from the same information: the failing test's name.
  function fix(who) {
    return [
      M(who, 'Asks to run the failing test and to search the code for `expires_at`, in one reply.'),
      T('The test fails: `assert 200 == 401`. The search finds the expiry check in `auth/session.py`, line 42, with a 10-minute grace period.'),
      M(who, 'Asks to edit the check to `token.expires_at > now`.'), T('Edit applied.'),
      M(who, 'Asks to run the test again.'), T('12 passed.')
    ];
  }
  function writeMigration(who) {
    return [M(who, 'Asks to write migration 0042 and update the Session model.'), T('2 files changed.')];
  }

  /* ---------- shapes and situations ---------- */

  var ARCHS = [
    { key: 'single', label: 'Single agent', preset: 'interactive, in memory', dims: {
      control: 'The model picks every step. Your code enforces the limits.',
      delegation: 'No split. One loop and one context.',
      trigger: 'In this preset, a person in a chat or a terminal.',
      durability: 'In this preset, nothing: the run lives in memory. The same loop can be checkpointed.' } },
    { key: 'planner', label: 'Planner and executor', preset: 'interactive, plan saved', dims: {
      control: 'A plan sets the order of the steps. A model writes the plan and fixes it when a step fails.',
      delegation: 'Two roles, often the same model with two prompts.',
      trigger: 'In this preset, a person, who can approve the plan first.',
      durability: 'In this preset, only the plan is saved, not the run.' } },
    { key: 'manager', label: 'Manager and workers', preset: 'interactive, in memory', dims: {
      control: 'The manager model decides what to hand out. Each worker picks its own steps.',
      delegation: 'One level: hand out the parts, then collect the results.',
      trigger: 'In this preset, a person, or a parent task.',
      durability: 'In this preset, nothing. Workers send summaries back.' } },
    { key: 'hierarchical', label: 'Hierarchy', preset: 'interactive, in memory', dims: {
      control: 'Models at every level decide what to hand down.',
      delegation: 'A tree, two or more levels deep.',
      trigger: 'In this preset, a large goal from a person.',
      durability: 'In this preset, nothing. Long runs need saved progress at every level.' } },
    { key: 'graph', label: 'Graph workflow', preset: 'any trigger, checkpointed', dims: {
      control: 'Your code sets the order. Models work inside steps, or choose between branches you drew.',
      delegation: 'None needed. A step can call a model, a tool, or a helper agent.',
      trigger: 'Anything: a person, an event, or a schedule.',
      durability: 'A checkpoint after every step, if you configure a store for it.' } },
    { key: 'event-driven', label: 'Event-driven', preset: 'queued, saved per event', dims: {
      control: 'Events start runs. Inside a run, any shape works. Here, a single agent.',
      delegation: 'Whatever the run uses. Here, none.',
      trigger: 'Events: webhooks, queue messages, schedules, chat messages.',
      durability: 'In this preset, state is saved after each event. An event trigger does not save state by itself.' } },
    { key: 'combined', label: 'Combined', preset: 'queued, checkpointed', dims: {
      control: 'A graph outside, and an agent loop inside the fix step.',
      delegation: 'Two read-only helpers: an explorer and a reviewer.',
      trigger: 'Events: CI failures, labeled issues, chat messages, and a nightly schedule.',
      durability: 'A checkpoint after every step. Finished steps survive a crash, and an unfinished step may run again.' } }
  ];

  var CONDS = [
    { key: 'research', label: 'Separate research tasks',
      task: 'Find every call to `parse_legacy_token()` in three services (api, billing, admin), and list them by file and line. The three searches share nothing.' },
    { key: 'coupled', label: 'Edits that depend on each other',
      task: 'Store session tokens hashed. `create_token()` and `is_valid()` are both in `auth/session.py`, and they must use the same hash.' },
    { key: 'event', label: 'An outside event starts the work',
      task: 'CI fails on main at 02:10, and the webhook names the failing test. Patch should prepare a fix and ask a person to approve the pull request.' },
    { key: 'approval', label: 'A long wait for approval',
      task: 'Add a `last_seen_at` column and update the shared staging database. That change needs a person to approve it, and the answer comes three hours later.' }
  ];

  /* ---------- the 28 authored cells ---------- */
  // Graph cells name their steps in `chain`; steps light up a chain link through `at`.

  var CELLS = {
    single: {
      research: { verdict: 'neutral',
        reason: 'It works, but the three searches run one after another, and every raw result piles up in one context. That is fine at this size, and it gets harder as each search returns more.',
        trace: [U(ASK_FIND)].concat(search('Patch')) },
      coupled: { verdict: 'helps',
        reason: 'One context holds every decision, so both functions use the same hash. The edits happen one after another, so there is nothing to merge.',
        trace: [U(ASK_HASH)].concat(hashEdit('Patch'), [M('Patch', 'Done. Both functions use SHA-256, and the tests pass.')]) },
      event: { verdict: 'hurts',
        reason: 'The loop itself is fine, but in this interactive preset nothing starts it, so the fix waits seven hours for a person. Put the same loop behind an event handler with saved state, and you get the event-driven preset.',
        trace: nobodyStarts().concat(fix('Patch'), [M('Patch', 'Fix ready. Writes the pull request description.'), R(ASK_DEV, 'approval', { req: PR_CI })]) },
      approval: { verdict: 'hurts',
        reason: 'In this in-memory preset, the loop waits three hours with the whole run in memory, so a restart during the wait loses it. Saving the pending request and ending the process fixes this, without changing the shape.',
        trace: [U(ASK_COLUMN)].concat(writeMigration('Patch'), [
          M('Patch', MIGRATE),
          R('Rule: changes to shared staging need approval. Your code holds the exact command as a pending request and waits, with the whole run in memory.', 'wait', { req: MIG }),
          H('Three hours later, the approver approves this exact request.', { approves: MIG }),
          R('The process is still up. Your code checks that the approval matches the pending request, then runs the command. A restart during the wait would have lost the run.', null, { resumes: MIG.id }),
          T('Staging updated.'),
          M('Patch', 'Done. The column is added and staging is updated.')]) }
    },

    planner: {
      research: { verdict: 'neutral',
        reason: 'The plan is obvious, one step per service, so the planning call adds little. The steps still run one after another in one context.',
        trace: [U(ASK_FIND), M('Planner', 'Plan: 1. Search api. 2. Search billing. 3. Search admin. 4. List the calls.')].concat(search('Executor')) },
      coupled: { verdict: 'helps',
        reason: 'The plan fixes the hash and the order of the edits before any file changes, so a reviewer can stop a wrong approach early. One executor makes every edit, so they agree. The cost is one extra call.',
        trace: [U(ASK_HASH),
          M('Planner', 'Asks to read `auth/session.py`.'), T('`create_token()` and `is_valid()` both use plain tokens.'),
          M('Planner', 'Plan: 1. Use SHA-256. 2. `create_token()` stores the hash. 3. `is_valid()` compares hashes. 4. Run the tests.'),
          H('A reviewer approves the plan before any file changes.'),
          M('Executor', 'Asks for one edit with both changes, as planned.'), T('Both changes applied.'),
          M('Executor', 'Asks to run the tests.'), T('12 passed.'),
          M('Executor', 'Done, as planned. Both functions use SHA-256.')] },
      event: { verdict: 'hurts',
        reason: 'Nothing starts it, so the fix waits for a person. Once it starts, the plan for a routine CI failure is always the same, so the planning call adds little.',
        trace: nobodyStarts().concat([M('Planner', 'Plan: 1. Reproduce. 2. Find the expiry check. 3. Fix. 4. Run the test again.')],
          fix('Executor'), [M('Executor', 'Fix ready. Writes the pull request description.'), R(ASK_DEV, 'approval', { req: PR_CI })]) },
      approval: { verdict: 'neutral',
        reason: 'The plan names the risky step in advance, so the approver knows it is coming. But in this preset only the plan is saved, so the executor still waits in memory for three hours.',
        trace: [U(ASK_COLUMN), M('Planner', 'Plan: 1. Write the migration. 2. Update staging (needs approval). 3. Report.')].concat(writeMigration('Executor'), [
          M('Executor', MIGRATE),
          R('Rule: this change needs approval. Your code holds the exact command as a pending request, and the executor waits with the run in memory.', 'wait', { req: MIG }),
          H('Three hours later, the approver approves this exact request. The plan told them it was coming.', { approves: MIG }),
          R('The process is still up. Your code checks that the approval matches the pending request, then runs the command.', null, { resumes: MIG.id }),
          T('Staging updated.'),
          M('Executor', 'Done, as planned.')]) }
    },

    manager: {
      research: { verdict: 'helps',
        reason: 'The searches share nothing, so three workers run them in parallel with clean contexts, and the manager reads three short summaries instead of raw output. The cost is twice the model calls.',
        trace: [U(ASK_FIND),
          M('Manager', 'Hands out three tasks in one reply: search api, search billing, search admin.'),
          R('Starts three workers at once. Each gets a fresh context and read-only tools.', 'parallel', { at: ['manager', 'w1', 'w2', 'w3'] })].concat(fanOut('Worker'), [
          R('Passes the three short summaries to the manager. The raw search output stays with the workers.'),
          M('Manager', LIST)]) },
      coupled: { verdict: 'hurts',
        reason: 'The two edits depend on each other, but each worker sees only its own half. They collide on the same lines and choose different hashes, so the manager redoes the work after eight calls instead of four.',
        trace: [U(ASK_HASH),
          M('Manager', 'Splits the job: Worker 1 changes `create_token()`, and Worker 2 changes `is_valid()`. Both are in `auth/session.py`.'),
          R('Starts both workers at once. Neither can see what the other chooses.', 'parallel', { at: ['manager', 'w1', 'w2'] }),
          M('Worker 1', 'Asks to edit `create_token()` so it stores a SHA-256 hash.'),
          M('Worker 2', 'Asks to edit `is_valid()` so it checks the token with bcrypt.'),
          T('Worker 1’s edit applied. Worker 2’s edit failed, because Worker 1 had just changed the same lines.', 'conflict'),
          M('Worker 2', 'Tries again on the new text, still with bcrypt. It never saw Worker 1’s choice.'), T('Edit applied.'),
          M('Worker 1', 'Reports: `create_token()` stores SHA-256 hashes.'),
          M('Worker 2', 'Reports: `is_valid()` uses bcrypt.'),
          R('The merge check runs the tests: 3 failed, because SHA-256 hashes are checked with bcrypt.', 'conflict', { at: ['manager', 'tools'] }),
          M('Manager', 'Reads both reports and rewrites `is_valid()` itself, with SHA-256.'), T('Edit applied. 12 passed.'),
          M('Manager', 'Done, after redoing part of the work.')] },
      event: { verdict: 'hurts',
        reason: 'Nothing starts it, so the fix waits for a person. Then the manager hands a small fix to one worker and rewrites its report, which costs two extra calls for no benefit.',
        trace: nobodyStarts().concat([M('Manager', 'Hands “reproduce and fix” to one worker. The fix is too small to split.')],
          fix('Worker'), [M('Worker', 'Reports: fix ready, and the tests pass.'), M('Manager', 'Writes the pull request description from the worker’s report.'), R(ASK_DEV, 'approval', { req: PR_CI })]) },
      approval: { verdict: 'hurts',
        reason: 'Two loops now wait in memory for one approval, so a restart loses more work. Splitting a small change also cost four extra calls, and parallel workers cannot make a person answer faster.',
        trace: [U(ASK_COLUMN),
          M('Manager', 'Hands out the work: Worker 1 writes and runs the migration, and Worker 2 updates the Session model.'),
          M('Worker 1', 'Asks to write migration 0042.'),
          M('Worker 2', 'Asks to update the Session model.'), T('Both edits applied.'),
          M('Worker 1', MIGRATE),
          R('Rule: this change needs approval. Your code holds the exact command as a pending request. Worker 1 waits, and the manager waits for Worker 1, so two loops hold the run in memory.', 'wait', { req: MIG, at: ['manager', 'w1'] }),
          M('Worker 2', 'Reports: the Session model is updated.'),
          H('Three hours later, the approver approves this exact request.', { approves: MIG }),
          R('The processes are still up. Your code checks that the approval matches the pending request, then runs the command.', null, { resumes: MIG.id, at: 'w1' }),
          T('Staging updated.'),
          M('Worker 1', 'Reports: staging is updated.'),
          M('Manager', 'Done.')] }
    },

    hierarchical: {
      research: { verdict: 'neutral',
        reason: 'The searches still run in parallel at the bottom, which helps. But the middle level adds two calls and another summary, with nothing to coordinate. A hierarchy pays off only when the work is too big for one manager.',
        trace: [U(ASK_FIND),
          M('Director', 'Hands the search to a lead.'),
          M('Lead', 'Hands one service to each of three workers.'),
          R('Starts three workers at once.', 'parallel', { at: ['lead', 'w1', 'w2', 'w3'] })].concat(fanOut('Worker'), [
          M('Lead', 'Combines the three summaries into one.'),
          M('Director', LIST)]) },
      coupled: { verdict: 'hurts',
        reason: 'This is the same split as manager and workers, plus a lead whose summary hides the mismatch. The director finds out only when the tests fail, two levels down. Work that shares a decision needs one agent that owns it.',
        trace: [U(ASK_HASH),
          M('Director', 'Hands “token storage” to the lead.'),
          M('Lead', 'Splits it: Worker 1 changes `create_token()`, and Worker 2 changes `is_valid()`.'),
          M('Worker 1', 'Asks to edit `create_token()` so it stores a SHA-256 hash.'),
          M('Worker 2', 'Asks to edit `is_valid()` so it checks the token with bcrypt.'),
          T('Both edits applied. They touched different lines, so neither failed.'),
          M('Worker 1', 'Reports: done.'),
          M('Worker 2', 'Reports: done.'),
          M('Lead', 'Reports “token hashing done”. Neither summary said which hash.', 'lossy'),
          R('CI runs the tests: 3 failed, because SHA-256 hashes are checked with bcrypt.', 'conflict', { at: 'tools' }),
          M('Director', 'Digs two levels down and rewrites `is_valid()` with SHA-256.'), T('Edit applied. 12 passed.'),
          M('Director', 'Done, after redoing part of the work.')] },
      event: { verdict: 'hurts',
        reason: 'Nothing starts it, so the fix waits for a person. Then a one-line fix passes through three levels, which adds four calls, and each level that passes the report along can drop a detail.',
        trace: nobodyStarts().concat([
          M('Director', 'Hands the failure to the lead.'),
          M('Lead', 'Hands it to a worker.')], fix('Worker'), [
          M('Worker', 'Reports: fix ready, and the tests pass.'),
          M('Lead', 'Passes the report up.'),
          M('Director', 'Writes the pull request description from the report.'),
          R(ASK_DEV, 'approval', { req: PR_CI })]) },
      approval: { verdict: 'hurts',
        reason: 'Three loops at three levels wait in memory for one approval. The request starts two levels down, so the approver sees a command but not the reasons for it. Then every level passes the result back up.',
        trace: [U(ASK_COLUMN),
          M('Director', 'Hands the schema change to the lead.'),
          M('Lead', 'Hands the migration to a worker.')].concat(writeMigration('Worker'), [
          M('Worker', MIGRATE),
          R('Rule: this change needs approval. Your code holds the exact command as a pending request. The worker waits, and so do the lead and the director, so three loops hold the run in memory.', 'wait', { req: MIG, at: ['director', 'lead', 'w1'] }),
          H('Three hours later, the approver approves this exact request, without the director’s reasons for it.', { approves: MIG }),
          R('The processes are still up. Your code checks that the approval matches the pending request, then runs the command.', null, { resumes: MIG.id, at: 'w1' }),
          T('Staging updated.'),
          M('Worker', 'Reports: staging is updated.'),
          M('Lead', 'Passes the report up.'),
          M('Director', 'Done.')]) }
    },

    graph: {
      research: { verdict: 'helps', chain: ['Search', 'Report'],
        reason: 'Your code already knows the three services, so it runs the searches in parallel and calls the model only once, to write the list. This works only because the steps were known before the run.',
        trace: [U(ASK_FIND),
          R('The graph fans out: your code runs the same search in all three services at once. No model decides the split.', 'parallel', { at: 'g-search' }),
          T('api: 4 calls. billing: none. admin: 2.'),
          M('Report step', LIST, null, { at: 'g-report' })] },
      coupled: { verdict: 'neutral', chain: ['Plan', 'Edit', 'Test', 'Review'],
        reason: 'All edits happen in one edit step, so they agree. The tests run as code, so they cost no model call. The fixed plan and review steps add checks, but the shape does nothing special for the editing itself.',
        trace: [U(ASK_HASH),
          R('The graph starts at the plan step. Your code puts `auth/session.py`, named in the task, into its context.', null, { at: 'g-plan' }),
          M('Plan step', 'Use SHA-256 in both `create_token()` and `is_valid()`.', null, { at: 'g-plan' }),
          M('Edit step', 'Asks for one edit with both changes.', null, { at: 'g-edit' }), T('Both changes applied.'),
          R('Test step (code, no model): 12 passed.', null, { at: 'g-test' }),
          M('Review step', 'Checks the change against the plan: approved.', null, { at: 'g-review' }),
          R('The graph ends. Your code saved progress after each finished step.', 'checkpoint', { at: ['g-review', 'store'] })] },
      event: { verdict: 'helps', chain: ['Reproduce', 'Find file', 'Diagnose', 'Fix', 'Test', 'Write PR', 'Approval'],
        reason: 'The webhook starts the graph at once, and each finished step is saved. A configured map from tests to source files pointed to the right file. Without such a map, fixed steps could not go looking, and the fix step would need an agent loop, as in the combined design.',
        trace: [E(CI_FAIL + ' The webhook starts the graph.', null, { starts: true }),
          R('Reproduce step (code): runs the failing test. Each finished step is saved.', 'checkpoint', { at: ['g-reproduce', 'store'] }),
          T('The test fails: `assert 200 == 401`.'),
          R('Find-file step (code): looks up `tests/test_auth.py` in a configured map from tests to source files, and finds `auth/session.py`.', null, { at: 'g-find-file' }),
          M('Diagnose step', 'The 10-minute grace period in `auth/session.py` keeps expired tokens valid.', null, { at: 'g-diagnose' }),
          M('Fix step', 'Asks to edit the check to `token.expires_at > now`.', null, { at: 'g-fix' }), T('Edit applied.'),
          R('Test step (code, no model): 12 passed.', null, { at: 'g-test' }),
          M('PR step', 'Writes the pull request description.', null, { at: 'g-write-pr' }),
          R('Approval step: your code ' + ASK_LATER, 'approval', { at: 'g-approval', req: PR_CI })] },
      approval: { verdict: 'helps', chain: ['Write', 'Approval', 'Update', 'Report'],
        reason: 'The approval is a step in the graph. The run saves the exact request and the process ends, so the three-hour wait costs nothing. The approval resumes the run only if it matches the saved request.',
        trace: [U(ASK_COLUMN), R('The graph starts at the write step.', null, { at: 'g-write' }),
          M('Write step', 'Asks to write migration 0042 and update the Session model.', null, { at: 'g-write' }), T('2 files changed.'),
          R('Approval step: your code saves the exact command as a pending request, asks for approval, and the process exits.', 'checkpoint', { at: 'g-approval', req: MIG }),
          H('Three hours later, the approver approves this exact request.', { approves: MIG }),
          R('The approval restarts the graph from the saved run. Your code checks that it matches the saved request, saves operation key op-0042 as attempted, and runs the command.', 'op', { at: 'g-update', resumes: MIG.id }),
          T('Staging updated.'),
          R(RECONCILE, null, { at: ['g-update', 'store'] }),
          M('Report step', 'Done. The column is added and staging is updated.', null, { at: 'g-report' })] }
    },

    'event-driven': {
      research: { verdict: 'neutral',
        reason: 'Here the event is a chat message, so the trigger changes nothing about the search. Inside the run you still pick a shape, and this one runs a single agent with the same tradeoffs.',
        trace: [E('A chat message arrives: ' + ASK_FIND), R('Loads this thread’s saved state and starts a run.', null, { starts: true })].concat(search('Patch'), [
          R('Saves the thread’s state and posts the reply.', 'checkpoint')]) },
      coupled: { verdict: 'neutral',
        reason: 'The trigger does not matter for editing. The edits stay consistent because one loop inside the run makes all of them.',
        trace: [E('Issue #88 gets the label “patch”: ' + ASK_HASH), R('Loads the saved state for issue #88 (none yet) and starts a run.', null, { starts: true })].concat(hashEdit('Patch'), [
          M('Patch', 'Done. Both functions use SHA-256, and the tests pass. Writes the pull request description.'),
          R('Saves the exact pull request for issue #88 as a pending request, asks for approval, and ends the run.', 'approval', { req: PR_88 })]) },
      event: { verdict: 'helps',
        reason: 'The webhook starts the run at once, and an atomic claim on the delivery id means a second copy, even one arriving at the same moment, starts nothing. The run stops at “fix ready, approval requested”, with the exact pull request saved for the morning.',
        trace: [E(CI_FAIL + ' Webhook delivery d-551.'),
          R('Claims d-551 with one atomic write that fails if the id is already there. The claim succeeds, so your code loads the saved state for main and starts a run.', null, { starts: true, at: ['handler', 'store'] }),
          E('A second copy of d-551 arrives a second later. Senders retry, so this is normal.'),
          R('The claim for d-551 already exists, so the copy starts nothing.', 'dedupe', { at: ['handler', 'store'] })].concat(fix('Patch'), [
          M('Patch', 'Fix ready. Writes the pull request description.'),
          R('Your code ' + ASK_LATER, 'approval', { req: PR_CI })]) },
      approval: { verdict: 'helps',
        reason: 'The approval is just another event. The run saves the pending request and ends, so nothing sits in memory for three hours. The answer arrives as a new event, which resumes the run only if it matches the saved request.',
        trace: [E('A chat message arrives: ' + ASK_COLUMN), R('Loads this thread’s saved state and starts a run.', null, { starts: true })].concat(writeMigration('Patch'), [
          M('Patch', MIGRATE),
          R('Rule: this change needs approval. Your code saves the run with the exact pending request, posts the request, and ends the run. Nothing waits in memory.', 'checkpoint', { req: MIG }),
          H('Three hours later, the approver approves this exact request in the chat. The answer is a new event.', { approves: MIG }),
          R('Loads the saved run, checks that the approval matches the pending request, saves operation key op-0042 as attempted, and runs the command.', 'op', { resumes: MIG.id }),
          T('Staging updated.'),
          R(RECONCILE),
          M('Patch', 'Done. The column is added and staging is updated.')]) }
    },

    combined: {
      research: { verdict: 'neutral',
        reason: 'It works, and the explorers search in parallel with clean contexts. But for a one-off question from a person, the triage call, the graph, and the event handling are extra parts to build and run for little gain.',
        trace: [E('A chat message arrives: ' + ASK_FIND),
          R('A new request, so the graph starts at the triage step.', null, { starts: true, at: ['handler', 'c-triage'] }),
          M('Triage', 'Sends it down the search path.', null, { at: 'c-triage' }),
          M('Patch', 'Starts three read-only explorers, one per service.'),
          R('Runs the explorers at once.', 'parallel', { at: ['agent', 'explorer'] })].concat(fanOut('Explorer'), [
          M('Patch', LIST),
          R('Saves progress and posts the reply.', 'checkpoint', { at: ['handler', 'store'] })]) },
      coupled: { verdict: 'helps',
        reason: 'One agent makes every write, so the edits agree, and the reviewer only reads, so it cannot conflict. The cost is a triage call and a review call, though the tests run as code and save one call.',
        trace: [E('Issue #88 gets the label “patch”: ' + ASK_HASH),
          R('A new issue, so a new run. The graph starts at the triage step.', null, { starts: true, at: ['handler', 'c-triage'] }),
          M('Triage', 'Sends it down the fix path.', null, { at: 'c-triage' }),
          M('Patch', 'Asks to read `auth/session.py`.'), T('`create_token()` and `is_valid()` both use plain tokens.'),
          M('Patch', 'Asks for one edit that changes both functions to SHA-256.'), T('Both changes applied.'),
          R('Test step (code, no model): 12 passed. Progress saved.', 'checkpoint', { at: ['c-test', 'store'] }),
          M('Reviewer', 'Reads the change without write tools: both functions use the same hash, and no plain tokens remain.'),
          M('Patch', 'Writes the pull request description.'),
          R('Approval step: saves the exact pull request for issue #88 as a pending request, asks for approval, and the process exits.', 'approval', { at: 'c-approval', req: PR_88 })] },
      event: { verdict: 'helps',
        reason: 'The webhook starts it at once, and the fix step is an agent loop, so it can explore when the cause is not obvious. Each finished step is saved, and the run stops at “fix ready, approval requested”. It costs two more calls than the event-driven single agent.',
        trace: [E(CI_FAIL + ' Webhook delivery d-551.'),
          R('Claims d-551 with one atomic write, then starts the graph at the triage step. Each finished step is saved.', 'checkpoint', { starts: true, at: ['handler', 'store'] }),
          M('Triage', 'Sends a failing test on main down the fix path.', null, { at: 'c-triage' }),
          M('Patch', 'Starts a read-only explorer: find where token expiry is checked.'),
          M('Explorer', 'Asks to search for `expires_at`.'), T('3 matches.'),
          M('Explorer', 'Summary: line 42 of `auth/session.py` keeps a 10-minute grace period.'),
          M('Patch', 'Asks to edit the check to `token.expires_at > now`.'), T('Edit applied.'),
          R('Test step (code, no model): 12 passed.', null, { at: 'c-test' }),
          M('Patch', 'Fix ready. Writes the pull request description.'),
          R('Approval step: your code ' + ASK_LATER, 'approval', { at: 'c-approval', req: PR_CI })] },
      approval: { verdict: 'helps',
        reason: 'The approval is a step, so the run saves the exact request and the process ends while it waits. An operation key saved before the command runs means a crash cannot repeat it blindly. The cost is a triage call and a graph to build and maintain.',
        trace: [E('A chat message arrives: ' + ASK_COLUMN),
          R('A new request, so the graph starts at the triage step.', null, { starts: true, at: ['handler', 'c-triage'] }),
          M('Triage', 'Sends a schema change down the fix path, which has an approval step.', null, { at: 'c-triage' })].concat(writeMigration('Patch'), [
          R('Approval step: your code saves the exact command as a pending request, asks for approval, and the process exits.', 'checkpoint', { at: 'c-approval', req: MIG }),
          H('Three hours later, the approver approves this exact request.', { approves: MIG }),
          R('The approval event restarts the graph. Your code checks that it matches the saved request, saves operation key op-0042 as attempted, and runs the command.', 'op', { at: ['handler', 'c-approval'], resumes: MIG.id }),
          T('Staging updated.'),
          R(RECONCILE, null, { at: ['handler', 'store'] }),
          M('Patch', 'Done. The column is added and staging is updated.')]) }
    }
  };

  /* ---------- pictures: which parts each shape has ---------- */

  var PARTS = {
    agent: ['Patch', 'agent loop'], planner: ['Planner step', 'asks the model for a plan'], executor: ['Executor', 'agent loop'],
    manager: ['Manager', 'agent loop'], w1: ['Worker 1', 'agent loop'], w2: ['Worker 2', 'agent loop'], w3: ['Worker 3', 'agent loop'],
    director: ['Director', 'agent loop'], lead: ['Lead', 'agent loop'],
    handler: ['Event handler', 'claims events, loads and saves state'],
    'c-triage': ['Triage step', 'one model call'], 'c-test': ['Test step', 'code only'], 'c-approval': ['Approval step', 'saves the request'],
    explorer: ['Explorers', 'read-only helpers'], reviewer: ['Reviewer', 'read-only helper'],
    model: ['Model', 'every model call'], tools: ['Tools', 'files, tests, search'], store: ['Saved state', 'checkpoints and requests'],
    person: ['Person', 'approves or starts work']
  };
  // Each middle row is a chain (arrows between parts) or a fan (parts side by side).
  var LAYOUT = {
    single: [{ chain: ['agent'] }],
    planner: [{ chain: ['planner', 'executor'] }],
    manager: [{ chain: ['manager'] }, { fan: ['w1', 'w2', 'w3'] }],
    hierarchical: [{ chain: ['director'] }, { chain: ['lead'] }, { fan: ['w1', 'w2', 'w3'] }],
    graph: 'chain',
    'event-driven': [{ chain: ['handler', 'agent'] }],
    combined: [{ chain: ['handler', 'c-triage', 'agent', 'c-test', 'c-approval'] }, { fan: ['explorer', 'reviewer'] }]
  };
  var SAVES = { graph: true, 'event-driven': true, combined: true };
  var DEFAULT_AT = { single: 'agent', planner: 'executor', manager: 'manager', hierarchical: 'director', graph: 'g-0', 'event-driven': 'handler', combined: 'handler' };
  var FLAG_PARTS = { approval: ['person', 'store'], checkpoint: ['store'], dedupe: ['store'], op: ['store'] };

  function slug(label) { return 'g-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-'); }
  function agentPart(arch, who) {
    if (who === 'Patch') return 'agent';
    if (who === 'Planner') return 'planner';
    if (who === 'Executor') return 'executor';
    if (who === 'Manager') return 'manager';
    if (who === 'Director') return 'director';
    if (who === 'Lead') return 'lead';
    if (who === 'Triage') return 'c-triage';
    if (who === 'Reviewer') return 'reviewer';
    if (/^Explorer/.test(who)) return 'explorer';
    var m = /^Worker ?(\d)?$/.exec(who);
    if (m) return 'w' + (m[1] || '1');
    return null;
  }

  function picture(archKey, condKey, trace) {
    var cell = CELLS[archKey][condKey];
    var layout = LAYOUT[archKey] === 'chain' ? [{ chain: cell.chain.map(slug) }] : LAYOUT[archKey];
    var nodes = [{ id: 'start', label: trace[0].actor === 'event' ? (condKey === 'event' ? 'CI webhook' : 'Event') : 'User', sub: 'starts the run', role: trace[0].actor === 'event' ? 'tool' : 'human' }];
    var rows = [{ kind: 'start', ids: ['start'] }];
    layout.forEach(function (row) {
      var ids = row.chain || row.fan;
      ids.forEach(function (id) {
        var named = PARTS[id] || [cell.chain.filter(function (l) { return slug(l) === id; })[0], 'graph step'];
        nodes.push({ id: id, label: named[0], sub: named[1], role: 'runtime' });
      });
      rows.push({ kind: row.chain ? 'chain' : 'fan', ids: ids });
    });
    var shared = ['model', 'tools'].concat(SAVES[archKey] ? ['store'] : [], ['person']);
    shared.forEach(function (id) {
      nodes.push({ id: id, label: PARTS[id][0], sub: PARTS[id][1], role: { model: 'model', tools: 'tool', store: 'state', person: 'human' }[id] });
    });
    rows.push({ kind: 'shared', ids: shared });
    return { nodes: nodes, rows: rows };
  }

  function partsFor(archKey, st, firstChainId, have) {
    var at = st.at ? [].concat(st.at) : null;
    var out;
    if (st.actor === 'user' || st.actor === 'event') out = ['start'];
    else if (st.actor === 'human') out = ['person'];
    else if (st.actor === 'tool') out = ['tools'];
    else if (st.actor === 'model') out = (at || [agentPart(archKey, st.who)]).concat(['model']);
    else out = at || [DEFAULT_AT[archKey] === 'g-0' ? firstChainId : DEFAULT_AT[archKey]];
    (FLAG_PARTS[st.flag] || []).forEach(function (p) { if (have[p] && out.indexOf(p) === -1) out.push(p); });
    return out;
  }

  /* ---------- pure logic ---------- */

  function byKey(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    throw new Error('unknown key: ' + key);
  }
  function modelCalls(trace) { return trace.filter(function (st) { return st.actor === 'model'; }).length; }

  // A decision resumes only the exact request it was given for.
  function canResume(pending, approval) {
    return !!(pending && approval && pending.id === approval.id && pending.action === approval.action && pending.target === approval.target);
  }

  // The crash window around one outside action, such as opening an approved pull request.
  // Your code saves the operation as "intended", marks it "attempted", sends it, then marks it "confirmed".
  // o.crash: 'none' | 'after-intent' | 'after-attempt' | 'after-send'. o.policy picks what a restarted worker does.
  function publish(o) {
    var created = 0;
    var inFlight = false;          // the receiver has the request but does not show it yet
    var states = [];
    function save(state) { states.push(state); }
    function send(withKey) {
      if (withKey && o.key && o.dedupes && o.withinRetention && created) return;   // the receiver recognizes the key
      created += 1;
    }
    function lookup(afterDelay) { return (afterDelay || !inFlight) && created > 0; }
    function result() { return { prs: created, state: states[states.length - 1], states: states }; }
    function resume() {
      var last = states[states.length - 1];
      if (last === 'intended') { save('attempted'); send(true); save('confirmed'); return result(); }   // never sent: safe
      save('outcome unknown');
      if (o.policy === 'blind-retry') send(false);
      else if (o.policy === 'key-retry') send(true);
      else if (o.policy === 'lookup-then-send') { if (!lookup(false)) send(true); }
      else if (o.key && o.dedupes && o.withinRetention) send(true);                 // safe: the receiver drops repeats
      else if (!lookup(true)) send(true);                                           // safe: check after the receiver's delay
      save('confirmed');
      return result();
    }
    save('intended');
    if (o.crash === 'after-intent') return resume();
    save('attempted');
    if (o.crash === 'after-attempt') return resume();
    send(true);
    inFlight = !!o.lookupLags;
    if (o.crash === 'after-send') return resume();
    save('confirmed');
    return result();
  }

  function view(archKey, condKey) {
    var arch = byKey(ARCHS, archKey);
    var cond = byKey(CONDS, condKey);
    var cell = CELLS[archKey][condKey];
    var pic = picture(archKey, condKey, cell.trace);
    var firstChainId = pic.rows[1].ids[0];
    var have = {};
    pic.nodes.forEach(function (nd) { have[nd.id] = true; });
    var n = 0;
    var trace = cell.trace.map(function (st) {
      var copy = {};
      Object.keys(st).forEach(function (k) { copy[k] = st[k]; });
      copy.call = null;
      if (st.actor === 'model') { n += 1; copy.call = n; }
      copy.nodes = partsFor(archKey, st, firstChainId, have);
      return copy;
    });
    return {
      arch: arch, cond: cond, verdict: cell.verdict, reason: cell.reason, trace: trace, picture: pic,
      calls: modelCalls(trace),
      label: n + ' model call' + (n === 1 ? '' : 's') + ' (illustrative)'
    };
  }

  AC.sims['architectures'] = { architectures: ARCHS, conditions: CONDS, view: view, modelCalls: modelCalls, canResume: canResume, publish: publish };

  /* ---------- widget ---------- */

  var ACTOR = { user: ['user', 'User'], model: ['model', 'Model'], runtime: ['runtime', 'Your code'], tool: ['tool', 'Tool'], human: ['human', 'Person'], event: ['tool', 'Event'] };
  var VERDICT = { helps: ['ok', 'Helps'], neutral: ['mid', 'No real difference'], hurts: ['bad', 'Hurts'] };
  var FLAG = { conflict: ['bad', 'Conflict'], lossy: ['bad', 'Detail lost'], delay: ['bad', 'Delay'], wait: ['bad', 'Held in memory'],
    checkpoint: ['ok', 'Progress saved'], dedupe: ['ok', 'Duplicate ignored'], parallel: ['mid', 'In parallel'],
    approval: ['ok', 'Approval requested'], op: ['ok', 'Operation key saved'] };
  var DIM_LABELS = [['control', 'Who decides the next step'], ['delegation', 'How the work is split'], ['trigger', 'What starts a run'], ['durability', 'What survives a crash']];

  AC.widgets['architectures'] = function (root) {
    var h = AC.h;
    var state = {
      arch: ARCHS.some(function (a) { return a.key === root.getAttribute('data-arch'); }) ? root.getAttribute('data-arch') : 'single',
      cond: CONDS.some(function (c) { return c.key === root.getAttribute('data-condition'); }) ? root.getAttribute('data-condition') : 'research'
    };
    var x = view(state.arch, state.cond);

    // `code` spans inside authored text become <code> elements.
    function rich(text) {
      return text.split('`').map(function (part, i) { return i % 2 ? h('code', { text: part }) : part; });
    }
    function tabRow(label, list, key) {
      var id = AC.uid('arch-lbl');
      var row = h('div', { class: 'w-tabs', role: 'group', 'aria-labelledby': id });
      list.forEach(function (item) {
        row.appendChild(h('button', { class: 'w-tab', type: 'button', 'data-key': item.key, text: item.label,
          on: { click: function () { state[key] = item.key; choose(); } } }));
      });
      return [h('p', { class: 'arch-sel-label', id: id, text: label }), row];
    }

    var archRow = tabRow('1. Pick a shape', ARCHS, 'arch');
    var condRow = tabRow('2. Pick a situation', CONDS, 'cond');
    var task = h('p', { class: 'arch-task' });
    var pic = h('div', { class: 'arch-pic', 'aria-hidden': 'true' });
    var legend = h('p', { class: 'arch-legend', text: 'Blue boxes are your code. The purple box is the model. Green is tools and outside events, amber is saved state, and rose is a person.' });
    var verdictBox = h('div', { class: 'arch-verdict-box' });
    var traceList = h('ol', { class: 'arch-trace' });
    var traceSummary = h('summary');
    var dims = h('div', { class: 'arch-dims-body' });

    function paintTop() {
      [[archRow[1], state.arch], [condRow[1], state.cond]].forEach(function (pair) {
        pair[0].querySelectorAll('.w-tab').forEach(function (t) { t.setAttribute('aria-pressed', String(t.getAttribute('data-key') === pair[1])); });
      });
      task.textContent = '';
      task.appendChild(h('span', { class: 'badge', text: 'Task' }));
      task.appendChild(h('span', null, rich(x.cond.task)));

      pic.textContent = '';
      x.picture.rows.forEach(function (row, r) {
        if (r) pic.appendChild(h('div', { class: 'arch-arrow', text: row.kind === 'shared' ? '↓ ↑' : '↓' }));
        var line = h('div', { class: 'arch-row arch-row-' + row.kind });
        row.ids.forEach(function (id, k) {
          var node = x.picture.nodes.filter(function (nd) { return nd.id === id; })[0];
          if (k && row.kind === 'chain') line.appendChild(h('span', { class: 'arch-link', text: '→' }));
          line.appendChild(h('div', { class: 'arch-node ' + node.role, 'data-node': id },
            h('span', { class: 'arch-node-label', text: node.label }),
            h('span', { class: 'arch-node-sub', text: node.sub })));
        });
        pic.appendChild(line);
      });

      verdictBox.textContent = '';
      verdictBox.appendChild(h('p', { class: 'arch-verdict' },
        h('span', { class: 'w-status ' + VERDICT[x.verdict][0], text: VERDICT[x.verdict][1] }),
        h('span', { class: 'arch-verdict-what', text: x.arch.label + ' (' + x.arch.preset + '), ' + x.cond.label.toLowerCase() })));
      verdictBox.appendChild(h('p', { class: 'arch-reason', text: x.reason }));

      traceSummary.textContent = 'All ' + x.trace.length + ' steps, ' + x.label;
      traceList.textContent = '';
      x.trace.forEach(function (st) {
        traceList.appendChild(h('li', { class: st.call ? 'is-call' : null },
          h('span', { class: 'badge ' + ACTOR[st.actor][0], text: ACTOR[st.actor][1] }),
          st.who ? h('span', { class: 'arch-who', text: st.who + ':' }) : null,
          h('span', null, rich(st.text)),
          st.flag ? h('span', { class: 'arch-flag ' + FLAG[st.flag][0], text: FLAG[st.flag][1] }) : null));
      });

      dims.textContent = '';
      dims.appendChild(h('p', { class: 'arch-preset', text: 'Preset shown: ' + x.arch.preset + '. What starts a run and what survives a crash are separate choices, so any shape can be interactive and in memory, or queued and checkpointed.' }));
      var dl = h('dl', { class: 'arch-dims' });
      DIM_LABELS.forEach(function (d) {
        dl.appendChild(h('dt', { text: d[1] }));
        dl.appendChild(h('dd', { text: x.arch.dims[d[0]] }));
      });
      dims.appendChild(dl);
    }

    function render(i, narration) {
      var st = x.trace[i];
      pic.classList.add('has-active');
      pic.querySelectorAll('.arch-node').forEach(function (nd) {
        nd.classList.toggle('is-active', st.nodes.indexOf(nd.getAttribute('data-node')) !== -1);
      });
      traceList.querySelectorAll('li').forEach(function (li, k) { li.classList.toggle('current', k === i); });
      var soFar = x.trace.slice(0, i + 1).filter(function (s) { return s.actor === 'model'; }).length;
      narration.appendChild(h('p', { class: 'arch-say' },
        h('span', { class: 'badge ' + ACTOR[st.actor][0], text: ACTOR[st.actor][1] }),
        st.who ? h('span', { class: 'arch-who', text: st.who + ':' }) : null,
        h('span', null, rich(st.text)),
        st.flag ? h('span', { class: 'arch-flag ' + FLAG[st.flag][0], text: FLAG[st.flag][1] }) : null));
      narration.appendChild(h('p', { class: 'arch-count', text: 'Model calls so far: ' + soFar + ' of ' + x.calls + '.' }));
    }

    var stepper = AC.stepper({ count: function () { return x.trace.length; }, render: render, playDelay: 2200 });

    function choose() {
      x = view(state.arch, state.cond);
      paintTop();
      stepper.reset();
    }

    root.appendChild(h('div', { class: 'w-frame' },
      h('div', { class: 'w-head' }, h('p', { class: 'w-title', text: 'Architecture explorer' }),
        h('p', { class: 'w-sub', text: 'Press Next to follow the task one step at a time. Call counts are examples, not measurements.' })),
      h('div', { class: 'w-body arch-w' }, archRow, condRow, task, pic, legend, stepper.el, verdictBox,
        h('details', { class: 'arch-more' }, traceSummary, traceList),
        h('details', { class: 'arch-more' }, h('summary', { text: 'How this shape works' }), dims))));
    paintTop();
    stepper.go(0);
  };
})();
