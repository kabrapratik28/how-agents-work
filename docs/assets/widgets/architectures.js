/* Architecture explorer (chapter 14). Seven shapes in four situations. Each pair has a verdict
   (helps, neutral, hurts), a reason, and an authored trace. The model-call count is derived from the
   trace, never typed in. AC.sims['architectures'] is pure and tested by tools/sims/architectures.test.mjs. */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  /* ---------- trace steps ---------- */

  function step(actor, text, flag, who) { return { actor: actor, text: text, flag: flag || null, who: who || null }; }
  function U(text) { return step('user', text); }
  function E(text, flag) { return step('event', text, flag); }
  function R(text, flag) { return step('runtime', text, flag); }
  function T(text, flag) { return step('tool', text, flag); }
  function H(text, flag) { return step('human', text, flag); }
  function M(who, text, flag) { return step('model', text, flag, who); }

  var ASK_AUDIT = 'Audit api, billing, and admin for code that still accepts the old token format.';
  var ASK_HASH = 'Store session tokens hashed instead of in plain text.';
  var ASK_COLUMN = 'Add a `last_seen_at` column to sessions and update the shared staging database.';
  var CI_FAIL = '02:10. CI fails on main: `test_login_expired_token`.';
  var MIGRATE = 'Asks to run `alembic upgrade head` on staging.';
  var REPORT = 'Reports 6 places: 4 in api, 2 in admin, none in billing.';

  // One loop audits the three services in turn: 4 model calls.
  function audit(who) {
    return [
      M(who, 'Asks to search api: `search_files("legacy_token", repo="api")`.'), T('api: 4 matches.'),
      M(who, 'Asks for the same search in billing.'), T('billing: no matches.'),
      M(who, 'Asks for the same search in admin.'), T('admin: 2 matches.'),
      M(who, REPORT)
    ];
  }
  // Three parallel helpers, each a search and a summary: 6 model calls.
  function fanOut(prefix) {
    return [
      M(prefix + ' 1', 'Searches api.'), M(prefix + ' 2', 'Searches billing.'), M(prefix + ' 3', 'Searches admin.'),
      T('api: 4 matches. billing: none. admin: 2.'),
      M(prefix + ' 1', 'Summary: 4 places, with file and line.'),
      M(prefix + ' 2', 'Summary: billing is clean.'),
      M(prefix + ' 3', 'Summary: 2 places, with file and line.')
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
      R('The alert lands in a chat channel. No loop is running, so nothing happens for seven hours.', 'delay'),
      H('09:05. A developer sees the alert and pastes it into Patch.')
    ];
  }
  function fix(who) {
    return [
      M(who, 'Asks to run the failing test and to read `auth/session.py`, in one reply.'),
      T('The test fails: `assert 200 == 401`. The file keeps a 10-minute grace period.'),
      M(who, 'Asks to edit the check to `token.expires_at > now`.'), T('Edit applied.'),
      M(who, 'Asks to run the test again.'), T('12 passed.')
    ];
  }
  function writeMigration(who) {
    return [M(who, 'Asks to write migration 0042 and update the Session model.'), T('2 files changed.')];
  }

  /* ---------- shapes and situations ---------- */

  var ARCHS = [
    { key: 'single', label: 'Single agent', shape: 'User → Agent ⇄ Tools', dims: {
      control: 'The model picks every step. Your code enforces the limits.',
      delegation: 'No split. One loop and one context.',
      trigger: 'Usually a person, in a chat or a terminal.',
      durability: 'Usually nothing. The run lives in memory.' } },
    { key: 'planner', label: 'Planner and executor', shape: 'Planner → Executor ⇄ Tools', dims: {
      control: 'A plan sets the order of the steps. A model writes the plan and fixes it when a step fails.',
      delegation: 'Two roles, often the same model with two prompts.',
      trigger: 'Usually a person, who can approve the plan first.',
      durability: 'The plan is easy to save. The run usually is not.' } },
    { key: 'manager', label: 'Manager and workers', shape: 'Manager → Workers → Manager', dims: {
      control: 'The manager model decides what to hand out. Each worker picks its own steps.',
      delegation: 'One level: hand out the parts, then collect the results.',
      trigger: 'Usually a person, or a parent task.',
      durability: 'Usually nothing. Workers send summaries back.' } },
    { key: 'hierarchical', label: 'Hierarchy', shape: 'Director → Leads → Workers', dims: {
      control: 'Models at every level decide what to hand down.',
      delegation: 'A tree, two or more levels deep.',
      trigger: 'A large goal, usually from a person.',
      durability: 'Long runs need saved progress at every level.' } },
    { key: 'graph', label: 'Graph workflow', shape: 'Step → Step → Step, with branches', dims: {
      control: 'Your code sets the order. Models work inside steps, or choose between branches you drew.',
      delegation: 'None needed. A step can call a model, a tool, or a helper agent.',
      trigger: 'Anything: a person, an event, or a schedule.',
      durability: 'Progress can be saved after every step.' } },
    { key: 'event-driven', label: 'Event-driven', shape: 'Event → load state → run the loop → save state', dims: {
      control: 'Events start runs. Inside a run, any shape works. Here, a single agent.',
      delegation: 'Whatever the run uses. Here, none.',
      trigger: 'Events: webhooks, queue messages, schedules, chat messages.',
      durability: 'Required. State is loaded when an event arrives and saved when the run ends.' } },
    { key: 'combined', label: 'Combined', shape: 'Event → Triage → Patch (with helpers) → Tests → Pull request', dims: {
      control: 'A graph outside, and an agent loop inside the fix step.',
      delegation: 'Two read-only helpers: an explorer and a reviewer.',
      trigger: 'Events: CI failures, labeled issues, chat messages, and a nightly schedule.',
      durability: 'Saved after every step. A wait ends the process, and an event resumes it.' } }
  ];

  var CONDS = [
    { key: 'research', label: 'Separate research tasks', short: 'Separate research',
      task: 'Audit three services (api, billing, admin) for code that still accepts the old session-token format. The three audits share nothing.' },
    { key: 'coupled', label: 'Edits that depend on each other', short: 'Dependent edits',
      task: 'Store session tokens hashed. `create_token()` and `is_valid()` are both in `auth/session.py`, and they must use the same hash.' },
    { key: 'event', label: 'An outside event starts the work', short: 'Outside event',
      task: 'CI fails on main at 02:10. The webhook names the failing test. Patch should fix it and open a pull request.' },
    { key: 'approval', label: 'A long wait for approval', short: 'Approval wait',
      task: 'Add a `last_seen_at` column and update the shared staging database. That change needs a person to approve it, and the answer comes three hours later.' }
  ];

  /* ---------- the 28 authored cells ---------- */

  var CELLS = {
    single: {
      research: { verdict: 'neutral',
        reason: 'It works, but the three searches run one after another, and every raw result piles up in one context. That is fine at this size, and it gets harder as each audit grows.',
        trace: [U(ASK_AUDIT)].concat(audit('Patch')) },
      coupled: { verdict: 'helps',
        reason: 'One context holds every decision, so both functions use the same hash. The edits happen one after another, so there is nothing to merge.',
        trace: [U(ASK_HASH)].concat(hashEdit('Patch'), [M('Patch', 'Done. Both functions use SHA-256, and the tests pass.')]) },
      event: { verdict: 'hurts',
        reason: 'The loop itself is fine, but nothing starts it, so the fix waits seven hours for a person. Put the same loop behind an event handler with saved state, and you get the event-driven shape.',
        trace: nobodyStarts().concat(fix('Patch'), [M('Patch', 'Fixed: expired tokens are rejected. Ready for a pull request.')]) },
      approval: { verdict: 'hurts',
        reason: 'The loop waits three hours with the whole run in memory, so a restart during the wait loses everything. Saving the waiting request and ending the process fixes this, without changing the shape.',
        trace: [U(ASK_COLUMN)].concat(writeMigration('Patch'), [
          M('Patch', MIGRATE),
          R('Rule: changes to shared staging need approval. Nothing runs, and the loop waits with the whole run in memory.', 'wait'),
          H('Three hours later, the approver approves the exact command.'),
          R('The process is still up, so your code runs the approved command. A restart during the wait would have lost the run.'),
          T('Staging updated.'),
          M('Patch', 'Done. The column is added and staging is updated.')]) }
    },

    planner: {
      research: { verdict: 'neutral',
        reason: 'The plan is obvious, one step per service, so the planning call adds little. The steps still run one after another in one context.',
        trace: [U(ASK_AUDIT), M('Planner', 'Plan: 1. Search api. 2. Search billing. 3. Search admin. 4. Report.')].concat(audit('Executor')) },
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
        trace: nobodyStarts().concat([M('Planner', 'Plan: 1. Reproduce. 2. Read the session code. 3. Fix. 4. Run the test again.')],
          fix('Executor'), [M('Executor', 'Fixed: expired tokens are rejected. Ready for a pull request.')]) },
      approval: { verdict: 'neutral',
        reason: 'The plan names the risky step in advance, so the approver knows it is coming. But the executor still waits in memory for three hours, because only the plan is easy to save, not the run.',
        trace: [U(ASK_COLUMN), M('Planner', 'Plan: 1. Write the migration. 2. Update staging (needs approval). 3. Report.')].concat(writeMigration('Executor'), [
          M('Executor', MIGRATE),
          R('Rule: this change needs approval. Nothing runs, and the executor waits with the run in memory.', 'wait'),
          H('Three hours later, the approver approves. The plan told them it was coming.'),
          R('The process is still up, so your code runs the approved command.'),
          T('Staging updated.'),
          M('Executor', 'Done, as planned.')]) }
    },

    manager: {
      research: { verdict: 'helps',
        reason: 'The audits share nothing, so three workers run them in parallel with clean contexts, and the manager reads three short summaries instead of raw output. The cost is twice the model calls, and anything a summary leaves out is lost.',
        trace: [U(ASK_AUDIT),
          M('Manager', 'Hands out three tasks in one reply: audit api, audit billing, audit admin.'),
          R('Starts three workers at once. Each gets a fresh context and read-only tools.', 'parallel')].concat(fanOut('Worker'), [
          R('Passes the three short summaries to the manager. The raw search output stays with the workers.'),
          M('Manager', REPORT)]) },
      coupled: { verdict: 'hurts',
        reason: 'The two edits depend on each other, but each worker sees only its own half. They collide on the same lines and choose different hashes, so the manager redoes the work after eight calls instead of four.',
        trace: [U(ASK_HASH),
          M('Manager', 'Splits the job: Worker 1 changes `create_token()`, and Worker 2 changes `is_valid()`. Both are in `auth/session.py`.'),
          R('Starts both workers at once. Neither can see what the other chooses.', 'parallel'),
          M('Worker 1', 'Asks to edit `create_token()` so it stores a SHA-256 hash.'),
          M('Worker 2', 'Asks to edit `is_valid()` so it checks the token with bcrypt.'),
          T('Worker 1’s edit applied. Worker 2’s edit failed, because Worker 1 had just changed the same lines.', 'conflict'),
          M('Worker 2', 'Tries again on the new text, still with bcrypt. It never saw Worker 1’s choice.'), T('Edit applied.'),
          M('Worker 1', 'Reports: `create_token()` stores SHA-256 hashes.'),
          M('Worker 2', 'Reports: `is_valid()` uses bcrypt.'),
          R('The merge check runs the tests: 3 failed, because SHA-256 hashes are checked with bcrypt.', 'conflict'),
          M('Manager', 'Reads both reports and rewrites `is_valid()` itself, with SHA-256.'), T('Edit applied. 12 passed.'),
          M('Manager', 'Done, after redoing part of the work.')] },
      event: { verdict: 'hurts',
        reason: 'Nothing starts it, so the fix waits for a person. Then the manager hands a small fix to one worker and passes its summary along, which costs two extra calls for no benefit.',
        trace: nobodyStarts().concat([M('Manager', 'Hands “reproduce and fix” to one worker. The fix is too small to split.')],
          fix('Worker'), [M('Worker', 'Reports: fixed, and the tests pass.'), M('Manager', 'Passes on the worker’s summary. Ready for a pull request.')]) },
      approval: { verdict: 'hurts',
        reason: 'Two loops now wait in memory for one approval, so a restart loses more work. Splitting a small change also cost four extra calls, and parallel workers cannot make a person answer faster.',
        trace: [U(ASK_COLUMN),
          M('Manager', 'Hands out the work: Worker 1 writes and runs the migration, and Worker 2 updates the Session model.'),
          M('Worker 1', 'Asks to write migration 0042.'),
          M('Worker 2', 'Asks to update the Session model.'), T('Both edits applied.'),
          M('Worker 1', MIGRATE),
          R('Rule: this change needs approval. Nothing runs. Worker 1 waits, and the manager waits for Worker 1, so two loops hold the run in memory.', 'wait'),
          M('Worker 2', 'Reports: the Session model is updated.'),
          H('Three hours later, the approver approves the exact command.'),
          R('The processes are still up, so your code runs the approved command.'),
          T('Staging updated.'),
          M('Worker 1', 'Reports: staging is updated.'),
          M('Manager', 'Done.')] }
    },

    hierarchical: {
      research: { verdict: 'neutral',
        reason: 'The audits still run in parallel at the bottom, which helps. But the middle level adds two calls and another summary, with nothing to coordinate. A hierarchy pays off only when the work is too big for one manager.',
        trace: [U(ASK_AUDIT),
          M('Director', 'Hands the audit to an audit lead.'),
          M('Audit lead', 'Hands one service to each of three workers.'),
          R('Starts three workers at once.', 'parallel')].concat(fanOut('Worker'), [
          M('Audit lead', 'Combines the three summaries into one.'),
          M('Director', REPORT)]) },
      coupled: { verdict: 'hurts',
        reason: 'This is the same split as manager and workers, plus a lead whose summary hides the mismatch. The director finds out only when the tests fail, two levels down. Work that shares a decision needs one agent that owns it.',
        trace: [U(ASK_HASH),
          M('Director', 'Hands “token storage” to the backend lead.'),
          M('Backend lead', 'Splits it: Worker 1 changes `create_token()`, and Worker 2 changes `is_valid()`.'),
          M('Worker 1', 'Asks to edit `create_token()` so it stores a SHA-256 hash.'),
          M('Worker 2', 'Asks to edit `is_valid()` so it checks the token with bcrypt.'),
          T('Both edits applied. They touched different lines, so neither failed.'),
          M('Worker 1', 'Reports: done.'),
          M('Worker 2', 'Reports: done.'),
          M('Backend lead', 'Reports “token hashing done”. Neither summary said which hash.', 'lossy'),
          R('CI runs the tests: 3 failed, because SHA-256 hashes are checked with bcrypt.', 'conflict'),
          M('Director', 'Digs two levels down and rewrites `is_valid()` with SHA-256.'), T('Edit applied. 12 passed.'),
          M('Director', 'Done, after redoing part of the work.')] },
      event: { verdict: 'hurts',
        reason: 'Nothing starts it, so the fix waits for a person. Then a one-line fix passes through three levels, which adds four calls, and each level that passes the report along can drop a detail.',
        trace: nobodyStarts().concat([
          M('Director', 'Hands the failure to the backend lead.'),
          M('Backend lead', 'Hands it to a worker.')], fix('Worker'), [
          M('Worker', 'Reports: fixed, and the tests pass.'),
          M('Backend lead', 'Passes the report up.'),
          M('Director', 'Passes the report on. Ready for a pull request.')]) },
      approval: { verdict: 'hurts',
        reason: 'Three loops at three levels wait in memory for one approval. The request starts two levels down, so the approver sees a command but not the reasons for it. Then every level passes the result back up.',
        trace: [U(ASK_COLUMN),
          M('Director', 'Hands the schema change to the backend lead.'),
          M('Backend lead', 'Hands the migration to a worker.')].concat(writeMigration('Worker'), [
          M('Worker', MIGRATE),
          R('Rule: this change needs approval. Nothing runs. The worker waits, and so do the lead and the director above it, so three loops hold the run in memory.', 'wait'),
          H('Three hours later, the approver approves. The request showed the worker’s command, but none of the director’s reasons.'),
          R('The processes are still up, so your code runs the approved command.'),
          T('Staging updated.'),
          M('Worker', 'Reports: staging is updated.'),
          M('Backend lead', 'Passes the report up.'),
          M('Director', 'Done.')]) }
    },

    graph: {
      research: { verdict: 'helps',
        reason: 'Your code already knows the three services, so it runs the searches in parallel without a model deciding how to split the work. It even skips the service with no matches. This works only because the steps were known before the run.',
        trace: [U(ASK_AUDIT),
          R('The graph fans out: your code runs the same search in all three services at once. No model decides the split.', 'parallel'),
          T('api: 4 matches. billing: none. admin: 2.'),
          R('Billing has no matches, so your code skips its model call.'),
          M('Check step (api)', 'Checks the 4 matches: all 4 accept the old format.'),
          M('Check step (admin)', 'Checks the 2 matches: both accept the old format.'),
          M('Report step', REPORT)] },
      coupled: { verdict: 'neutral',
        reason: 'All edits happen in one edit step, so they agree. The tests run as code, so they cost no model call. The fixed plan and review steps add checks, but the shape does nothing special for the editing itself.',
        trace: [U(ASK_HASH),
          R('The graph runs plan, edit, test, review. Your code puts `auth/session.py` into the plan step’s context.'),
          M('Plan step', 'Use SHA-256 in both `create_token()` and `is_valid()`.'),
          M('Edit step', 'Asks for one edit with both changes.'), T('Both changes applied.'),
          R('Test step (code, no model): 12 passed.'),
          M('Review step', 'Checks the change against the plan: approved.'),
          R('The graph ends. Your code saved progress after each step.')] },
      event: { verdict: 'helps',
        reason: 'The webhook starts the graph at once, and progress is saved after every step. It worked because your code could find the file from the error. If the cause were elsewhere, fixed steps could not go looking, and the fix step would need an agent loop, as in the combined design.',
        trace: [E(CI_FAIL + ' The webhook starts the graph at once.'),
          R('Reproduce step (code): runs the failing test. Progress is saved after each step.', 'checkpoint'),
          T('The test fails: `assert 200 == 401`.'),
          R('Your code takes the file name from the error and puts `auth/session.py` into the next step’s context.'),
          M('Diagnose step', 'The 10-minute grace period keeps expired tokens valid.'),
          M('Fix step', 'Asks to edit the check to `token.expires_at > now`.'), T('Edit applied.'),
          R('Test step (code, no model): 12 passed.'),
          M('Pull request step', 'Writes the pull request description.'),
          R('Opens the pull request at 02:14.')] },
      approval: { verdict: 'helps',
        reason: 'The approval is a step in the graph. The run saves its progress and the process ends, so the three-hour wait costs nothing and survives restarts. The approval restarts the run at the update step, tied to the exact command.',
        trace: [U(ASK_COLUMN), R('The graph runs write, approve, update, report.')].concat(writeMigration('Write step'), [
          R('Approval step: a request for the exact command goes out. Your code saves the run, and the process ends.', 'checkpoint'),
          H('Three hours later, the approver approves.'),
          R('The approval restarts the graph from the saved run, at the update step.'),
          T('Staging updated.'),
          M('Report step', 'Done. The column is added and staging is updated.')]) }
    },

    'event-driven': {
      research: { verdict: 'neutral',
        reason: 'Here the event is a chat message, so the trigger changes nothing about the audit. Inside the run you still pick a shape, and this one runs a single agent with the same tradeoffs.',
        trace: [E('A chat message arrives: ' + ASK_AUDIT), R('Loads this thread’s saved state and starts a run.')].concat(audit('Patch'), [
          R('Saves the thread’s state and posts the reply.')]) },
      coupled: { verdict: 'neutral',
        reason: 'The trigger does not matter for editing. The edits stay consistent because one loop inside the run makes all of them.',
        trace: [E('Issue #88 gets the label “patch”: ' + ASK_HASH), R('Loads the saved state for issue #88 (none yet) and starts a run.')].concat(hashEdit('Patch'), [
          M('Patch', 'Done. Both functions use SHA-256, and the tests pass.'),
          R('Saves state and comments on issue #88.')]) },
      event: { verdict: 'helps',
        reason: 'The webhook starts the run at once. The handler loads the saved state and saves it again at the end, and the delivery id makes a repeated webhook harmless. Inside, it is a plain single agent.',
        trace: [E(CI_FAIL + ' Webhook delivery d-551.'),
          R('d-551 is new, so your code loads the saved state for main and starts a run at once.')].concat(fix('Patch'), [
          M('Patch', 'Fixed: expired tokens are rejected. Writes the pull request description.'),
          R('Opens the pull request at 02:14, saves state, and marks d-551 as handled.'),
          E('The same webhook arrives again. Senders retry, so this is normal.'),
          R('d-551 is already handled, so nothing runs.', 'dedupe')]) },
      approval: { verdict: 'helps',
        reason: 'The approval is just another event. The run saves the waiting request and ends, so nothing sits in memory for three hours. The approver’s answer arrives as a new event, which loads the run and continues it.',
        trace: [E('A chat message arrives: ' + ASK_COLUMN), R('Loads this thread’s saved state and starts a run.')].concat(writeMigration('Patch'), [
          M('Patch', MIGRATE),
          R('Rule: this change needs approval. Your code saves the run with the waiting request, posts the request, and ends the run. Nothing waits in memory.', 'checkpoint'),
          H('Three hours later, the approver approves in the chat. The answer is a new event.'),
          R('Loads the saved run, checks that the approval matches the waiting request, and runs it.'),
          T('Staging updated.'),
          M('Patch', 'Done. The column is added and staging is updated.')]) }
    },

    combined: {
      research: { verdict: 'neutral',
        reason: 'It works, and the explorers search in parallel with clean contexts. But for a one-off question from a person, the triage call, the graph, and the event handling are extra parts to build and run for little gain.',
        trace: [E('A chat message arrives: ' + ASK_AUDIT),
          R('A new request, so the graph starts at the triage step.'),
          M('Triage', 'Sends it down the audit path.'),
          M('Patch', 'Starts three read-only explorers, one per service.'),
          R('Runs the explorers at once.', 'parallel')].concat(fanOut('Explorer'), [
          M('Patch', REPORT),
          R('Saves progress and posts the reply.')]) },
      coupled: { verdict: 'helps',
        reason: 'One agent makes every write, so the edits agree, and the reviewer only reads, so it cannot conflict. The cost is a triage call and a review call, though the tests run as code and save one call.',
        trace: [E('Issue #88 gets the label “patch”: ' + ASK_HASH),
          R('A new issue, so a new run. The graph starts at the triage step.'),
          M('Triage', 'Sends it down the fix path.'),
          M('Patch', 'Asks to read `auth/session.py`.'), T('`create_token()` and `is_valid()` both use plain tokens.'),
          M('Patch', 'Asks for one edit that changes both functions to SHA-256.'), T('Both changes applied.'),
          R('Test step (code, no model): 12 passed. Progress saved.', 'checkpoint'),
          M('Reviewer', 'Reads the change without write tools: both functions use the same hash, and no plain tokens remain.'),
          M('Patch', 'Writes the pull request description.'),
          R('Opens one pull request for issue #88.')] },
      event: { verdict: 'helps',
        reason: 'The webhook starts it at once, and the fix step is an agent loop, so it can explore when the cause is not obvious. A crash resumes from the last saved step instead of starting over. It costs two more calls than the event-driven single agent.',
        trace: [E(CI_FAIL + ' Webhook delivery d-551.'),
          R('d-551 is new, so the graph starts at the triage step. Progress is saved after each step.', 'checkpoint'),
          M('Triage', 'Sends a failing test on main down the fix path.'),
          M('Patch', 'Starts a read-only explorer: find where token expiry is checked.'),
          M('Explorer', 'Asks to search for `expires_at`.'), T('3 matches.'),
          M('Explorer', 'Summary: line 42 of `auth/session.py` keeps a 10-minute grace period.'),
          M('Patch', 'Asks to edit the check to `token.expires_at > now`.'), T('Edit applied.'),
          R('Test step (code, no model): 12 passed.'),
          M('Patch', 'Writes the pull request description.'),
          R('Opens the pull request at 02:16. A repeat of d-551 would be ignored.')] },
      approval: { verdict: 'helps',
        reason: 'The approval is a step, so the run saves its progress and the process ends while it waits. The approval is tied to the exact command and continues the graph where it stopped. The cost is a triage call and a graph to build and maintain.',
        trace: [E('A chat message arrives: ' + ASK_COLUMN),
          R('A new request, so the graph starts at the triage step.'),
          M('Triage', 'Sends a schema change down the fix path, which ends with an approval step.')].concat(writeMigration('Patch'), [
          R('Approval step: a request for the exact command goes out. Your code saves the run, and the process ends.', 'checkpoint'),
          H('Three hours later, the approver approves.'),
          R('The approval event restarts the graph from the saved run and runs the approved command.'),
          T('Staging updated.'),
          M('Patch', 'Done. The column is added and staging is updated.')]) }
    }
  };

  /* ---------- pure view logic ---------- */

  function find(list, key) {
    for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
    throw new Error('unknown key: ' + key);
  }
  function modelCalls(trace) { return trace.filter(function (st) { return st.actor === 'model'; }).length; }

  function view(archKey, condKey) {
    var arch = find(ARCHS, archKey);
    var cond = find(CONDS, condKey);
    var cell = CELLS[archKey][condKey];
    var n = 0;
    var counts = {};
    var order = [];
    var trace = cell.trace.map(function (st) {
      var copy = { actor: st.actor, text: st.text, flag: st.flag, who: st.who, call: null };
      if (st.actor === 'model') {
        n += 1;
        copy.call = n;
        if (!counts[st.who]) { counts[st.who] = 0; order.push(st.who); }
        counts[st.who] += 1;
      }
      return copy;
    });
    return {
      arch: arch, cond: cond, verdict: cell.verdict, reason: cell.reason, trace: trace,
      calls: modelCalls(trace),
      label: n + ' model call' + (n === 1 ? '' : 's') + ' (illustrative)',
      byAgent: order.map(function (w) { return { who: w, calls: counts[w] }; }),
      others: CONDS.map(function (c) { return { key: c.key, label: c.short, verdict: CELLS[archKey][c.key].verdict }; })
    };
  }

  AC.sims['architectures'] = { architectures: ARCHS, conditions: CONDS, view: view, modelCalls: modelCalls };

  /* ---------- widget ---------- */

  var ACTOR = { user: ['user', 'User'], model: ['model', 'Model'], runtime: ['runtime', 'Your code'], tool: ['tool', 'Tool'], human: ['human', 'Person'], event: ['tool', 'Event'] };
  var VERDICT = { helps: ['ok', 'Helps'], neutral: ['mid', 'No real difference'], hurts: ['bad', 'Hurts'] };
  var FLAG = { conflict: ['bad', 'Conflict'], lossy: ['bad', 'Detail lost'], delay: ['bad', 'Delay'], wait: ['bad', 'Held in memory'],
    checkpoint: ['ok', 'Progress saved'], dedupe: ['ok', 'Duplicate ignored'], parallel: ['mid', 'In parallel'] };
  var DIM_LABELS = [['control', 'Who decides the next step'], ['delegation', 'How the work is split'], ['trigger', 'What starts a run'], ['durability', 'What survives a crash']];

  AC.widgets['architectures'] = function (root) {
    var h = AC.h;
    var state = {
      arch: ARCHS.some(function (a) { return a.key === root.getAttribute('data-arch'); }) ? root.getAttribute('data-arch') : 'single',
      cond: CONDS.some(function (c) { return c.key === root.getAttribute('data-condition'); }) ? root.getAttribute('data-condition') : 'research'
    };

    // `code` spans inside authored text become <code> elements.
    function rich(text) {
      return text.split('`').map(function (part, i) { return i % 2 ? h('code', { text: part }) : part; });
    }

    function tabRow(label, list, key) {
      var id = AC.uid('arch-lbl');
      var row = h('div', { class: 'w-tabs', role: 'group', 'aria-labelledby': id });
      list.forEach(function (item) {
        row.appendChild(h('button', { class: 'w-tab', type: 'button', 'data-key': item.key, text: item.label,
          on: { click: function () { state[key] = item.key; paint(); } } }));
      });
      return [h('p', { class: 'arch-sel-label', id: id, text: label }), row];
    }

    var archRow = tabRow('1. Pick a shape', ARCHS, 'arch');
    var condRow = tabRow('2. Pick a situation', CONDS, 'cond');
    var task = h('p', { class: 'arch-task' });
    var verdictBox = h('div', { class: 'arch-verdict-box', 'aria-live': 'polite' });
    var others = h('div', { class: 'arch-others', role: 'group', 'aria-label': 'This shape in every situation' });
    var otherBtns = CONDS.map(function (c) {
      var b = h('button', { class: 'arch-other', type: 'button', on: { click: function () { state.cond = c.key; paint(); } } });
      others.appendChild(b);
      return b;
    });
    var tracePanel = h('div', { class: 'w-panel arch-trace-panel' });
    var dimsPanel = h('div', { class: 'w-panel arch-dims-panel' });

    var frame = h('div', { class: 'w-frame' },
      h('div', { class: 'w-head' }, h('p', { class: 'w-title', text: 'Architecture explorer' }),
        h('p', { class: 'w-sub', text: 'Call counts are examples, not measurements.' })),
      h('div', { class: 'w-body arch-w' }, archRow, condRow, task, verdictBox,
        h('div', { class: 'arch-others-row' }, h('p', { class: 'arch-others-title', text: 'This shape in every situation:' }), others),
        h('div', { class: 'arch-main' }, tracePanel, dimsPanel),
        h('p', { class: 'w-note', text: 'Each shape is shown the way it is usually built. Adding a trigger or saved progress can change a verdict.' })));

    function paint() {
      var x = view(state.arch, state.cond);
      [[archRow[1], state.arch], [condRow[1], state.cond]].forEach(function (pair) {
        pair[0].querySelectorAll('.w-tab').forEach(function (t) { t.setAttribute('aria-pressed', String(t.getAttribute('data-key') === pair[1])); });
      });

      task.textContent = '';
      task.appendChild(h('span', { class: 'badge', text: 'Task' }));
      task.appendChild(h('span', null, rich(x.cond.task)));

      verdictBox.textContent = '';
      verdictBox.appendChild(h('p', { class: 'arch-verdict' },
        h('span', { class: 'w-status ' + VERDICT[x.verdict][0], text: VERDICT[x.verdict][1] }),
        h('span', { class: 'arch-verdict-what', text: x.arch.label + ', ' + x.cond.label.toLowerCase() })));
      verdictBox.appendChild(h('p', { class: 'arch-reason', text: x.reason }));
      x.others.forEach(function (o, i) {
        var b = otherBtns[i];
        b.textContent = '';
        b.appendChild(document.createTextNode(o.label + ': '));
        b.appendChild(h('span', { class: 'arch-v-' + o.verdict, text: VERDICT[o.verdict][1].toLowerCase() }));
        b.setAttribute('aria-pressed', String(o.key === state.cond));
      });

      tracePanel.textContent = '';
      tracePanel.appendChild(h('p', { class: 'w-panel-title', text: 'Step by step: how the task flows' }));
      tracePanel.appendChild(h('p', { class: 'arch-calls', text: x.label }));
      var ol = h('ol', { class: 'arch-trace' });
      x.trace.forEach(function (st) {
        ol.appendChild(h('li', { class: st.call ? 'is-call' : null },
          h('span', { class: 'badge ' + ACTOR[st.actor][0], text: ACTOR[st.actor][1] }),
          st.who ? h('span', { class: 'arch-who', text: st.who + ':' }) : null,
          h('span', null, rich(st.text)),
          st.flag ? h('span', { class: 'arch-flag ' + FLAG[st.flag][0], text: FLAG[st.flag][1] }) : null));
      });
      tracePanel.appendChild(ol);

      dimsPanel.textContent = '';
      dimsPanel.appendChild(h('p', { class: 'w-panel-title', text: 'How this shape works' }));
      dimsPanel.appendChild(h('p', { class: 'arch-shape', text: x.arch.shape }));
      var dl = h('dl', { class: 'arch-dims' });
      DIM_LABELS.forEach(function (d) {
        dl.appendChild(h('dt', { text: d[1] }));
        dl.appendChild(h('dd', { text: x.arch.dims[d[0]] }));
      });
      dimsPanel.appendChild(dl);
    }

    root.appendChild(frame);
    paint();
  };
})();
