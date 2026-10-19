# Authoring guide

How to write and edit pages in this course. Read it before touching `docs/`. It is also the brief for AI authors. Canonical meanings of terms live in `notes/definitions.md` (not published); when in doubt, follow it.

## Who it is for

An experienced software engineer. They want to design agent systems and direct an AI coding system to build them. They do not want framework API tours or long code walkthroughs.

## Voice

The owner's rule: no AI slop, and every sentence easy to understand. Easy matters more than short.

- Use everyday words. Explain a technical term in plain words the first time it appears, with a small example.
- Give the example first, then the general rule.
- Connect ideas with "because", "so", "for example", and "but", so the reader sees the logic. Do not chop one thought into fragments.
- Use active voice with a clear actor: "The runtime runs the command."
- No slogans or clever one-liners ("The model proposes, the runtime disposes"). No filler or announcements ("Here is the thing", "Let's look at", "Three details matter"). No hype words (powerful, crucial, essential, simply, magic, game-changing). `tools/check.py` flags the common ones.
- Say each point once. Do not repeat it in the lede, the body, a callout, and the takeaways.
- Keep chapters short: most 1,500 to 2,500 words. Cut anything that does not help someone design an agent.
- One idea per sentence. Aim for 13 words or fewer on average and few sentences over 30 words. `tools/check.py` warns above that and fails at an average over 14 or more than 5% long sentences. It also warns when the reading grade goes above 9. Keep a qualification if the claim is false without it.
- Plain words. Say it the way you would at a whiteboard with a colleague.
- Concepts first. A framework appears only as an example of a general idea.
- Reduce vague terms to primitives, every time one appears ("Memory reduces to storage, a write policy, retrieval, and context injection").
- Use systems analogies (RPC, process input, snapshots, workers, caches) and always say where the analogy breaks.
- No false universals. When behavior varies, say "usually", "in this design", or name the system.
- Light bold: at most one bold phrase per paragraph, usually none.
- No em-dashes. Use a comma, colon, parentheses, or two sentences. No section sign; write "Section 3".
- Never use: delve, tapestry, testament, underscore (as a verb), leverage, landscape, seamless, robust, foster, navigate, load-bearing, spine, structural. Avoid "It's important to note", "In today's fast-paced world", rule-of-three cadence, and stacked Moreover/Furthermore.

## Code

- Only tiny pseudocode, small snippets, or simplified data structures. At most 20 lines per block. Python-flavored by default.
- A real excerpt is allowed only when it clarifies a concept. Label it with the project and version.

## Facts about real systems

- Use only facts in `notes/research/*.md`, which carry sources and versions. If a fact is not there, leave it out; do not hide an unverified claim behind vague wording.
- Say whether a capability is built in, optional, an extension, not built in, or unknown. "Unknown" is not "unsupported".
- Before chapter 17, real systems appear only when they clarify a mechanism (1-3 per chapter, optional).

## Page template

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Context · How AI Agents Work</title>
<meta name="description" content="One sentence about the chapter.">
<link rel="stylesheet" href="assets/site.css">
<script>try{var t=localStorage.getItem('haw:v1:theme');if(t)document.documentElement.dataset.theme=JSON.parse(t)}catch(e){}</script>
</head>
<body>
<header class="topbar"><a class="brand" href="index.html">How AI Agents Work</a><a class="map-link" href="index.html#map">Course map</a></header>
<main class="chapter" id="main">
  <header class="chapter-head">
    <p class="kicker">Chapter 4 · The core loop</p>
    <h1>Context</h1>
    <p class="lede">One sentence that states the idea of the chapter.</p>
    <div class="loop-map" data-focus="context"></div>
  </header>

  <section id="some-topic">
    <h2>Some topic</h2>
    <p>...</p>
  </section>

  <!-- closing sections, in this order -->
  <section id="running-example">...</section>
  <section id="design-checkpoint">...</section>  <!-- only in 04, 09, 11, 14, 16 -->
  <section id="what-goes-wrong">...</section>
  <section id="you-decide">...</section>
  <section id="check-yourself">...</section>
  <section id="takeaways">...</section>
  <section id="going-deeper">...</section>     <!-- optional -->
</main>
<script defer src="assets/chapters.js"></script>
<script defer src="assets/site.js"></script>
<script defer src="assets/widgets/stepper.js"></script>   <!-- only if a widget uses it -->
<script defer src="assets/widgets/NAME.js"></script>      <!-- one per widget on the page -->
</body>
</html>
```

- The static top bar is the no-JS fallback navigation: the home page carries a static course map. `site.js` adds the sidebar, prev/next links, progress, and the theme toggle.
- The kicker and h1 must match the entry in `assets/chapters.js`.
- Every `h2` section has an `id`. Use the ids listed in `notes/requirements.md`; `tools/check.py --all` verifies them.
- All URLs are relative (the site is served from `/how-agents-work/` on GitHub Pages).

## Chapter skeleton

1. Kicker, h1, lede, loop map.
2. Body sections with worked examples, diagrams, and callouts. Put each widget right next to the concept it demonstrates.
3. One "What does this reduce to?" callout per main idea (at least one) and one "Systems analogy" callout with "Where it breaks". "How real systems do it" only when it teaches a mechanism, at most 2 per chapter.
4. `#running-example`: what this chapter adds to Patch. 2-4 sentences plus a tiny diff of state or pseudocode.
5. `#design-checkpoint` in chapters 04, 09, 11, 14, 16 only (spec in `notes/checkpoints.md`).
6. `#what-goes-wrong`: 2-3 failure cards (why it happens, how to spot it, what to do).
7. `#you-decide`: "Decide yourself" and "Delegate to AI".
8. `#check-yourself`: 3 questions. Answers collapsed, never inline. Tag questions that match the course's 31 questions, for example "(Q12)".
9. `#takeaways`: 3 bullets.
10. `#going-deeper`: 1-4 links from `notes/research/sources.md`. Optional.

Exceptions (encoded in check.py): 15 (a failure catalogue), 17 and 17b (survey), 20 (exercises), 21 (brief), questions, glossary.

## The loop map

The core loop has six nodes. Use their keys in `data-focus` (space-separated for several, or `all`):

| key | label | performed by | color |
|---|---|---|---|
| `state` | State | data held by the runtime | state (amber) |
| `context` | Build context | runtime | runtime (blue) |
| `model` | Call model | model | model (violet) |
| `decide` | Model decides | model | model (violet) |
| `act` | Runtime acts | runtime (tools touch the world) | runtime (blue) |
| `update` | Update state | runtime | runtime (blue) |

Two of six nodes belong to the model. Everything else is ordinary code. That is the lesson of chapter 0, and the map repeats it on every page.

## Role colors

Every diagram and widget uses the same colors, always next to a text label (never color alone).

| class | role |
|---|---|
| `model` | the model (intelligence) |
| `runtime` | your code, the harness (control and authority) |
| `tool` | tools and the outside world |
| `state` | state, memory, storage |
| `context` | what the model sees in one call |
| `human` | a person |
| `user` | the user's message (styled like human) |

## Components

Callouts:

```html
<aside class="callout reduce">
  <p class="callout-title">What does this reduce to?</p>
  <p>Tool use = structured model output + runtime function dispatch.</p>
</aside>

<aside class="callout analogy">
  <p class="callout-title">Systems analogy</p>
  <p>A tool call is an RPC request. The schema is the IDL.</p>
  <p class="breaks"><strong>Where it breaks:</strong> the caller is a model that can pick the wrong method.</p>
</aside>

<aside class="callout cases">
  <p class="callout-title">How real systems do it</p>
  <ul><li><strong>Pi</strong> ships four tools: ...</li></ul>
</aside>

<aside class="callout warn">
  <p class="callout-title">Watch out</p>
  <p>...</p>
</aside>
```

Flow diagram (pills in role colors):

```html
<div class="flow">
  <span class="node runtime">Build context</span><span class="arrow" aria-hidden="true">→</span>
  <span class="node model">Call model</span><span class="arrow" aria-hidden="true">→</span>
  <span class="node tool">Run tool</span>
</div>
```

Add `vertical` for top-to-bottom: `<div class="flow vertical">`.

Box diagram (give it an `aria-label` that says what it shows):

```html
<figure>
<pre class="diagram" aria-label="Main agent delegates to a second loop and gets a result back">
Main agent
    | delegate("research X")
    v
Second agent loop
</pre>
<figcaption>Optional caption.</figcaption>
</figure>
```

Color words inside a diagram with `<span class="c-model">LLM</span>` (also `c-runtime`, `c-tool`, `c-state`, `c-context`, `c-human`).

Worked trace:

```html
<ol class="trace">
  <li><span class="badge user">User</span> Fix the failing auth test.</li>
  <li><span class="badge model">Model</span> <code>run_command("pytest tests/test_auth.py")</code></li>
  <li><span class="badge tool">Tool</span> exit 1: <code>assert 200 == 401</code></li>
</ol>
```

Table: `<table class="compare">` with a `<caption>` and `<th scope="col">` headers. Wrap wide tables in `<div class="table-wrap">`. Keep cells short.

Failure card (in `#what-goes-wrong`, or as the body of chapter 15):

```html
<div class="failure" id="infinite-loops">
  <h3>Infinite loops</h3>
  <dl>
    <dt>Why it happens</dt><dd>...</dd>
    <dt>How to spot it</dt><dd>...</dd>
    <dt>What to do</dt><dd>...</dd>
  </dl>
</div>
```

You decide, AI builds:

```html
<div class="decide-grid">
  <div class="decide"><h3>Decide yourself</h3><ul><li>...</li></ul></div>
  <div class="delegate"><h3>Delegate to AI</h3><ul><li>...</li></ul></div>
</div>
```

Quiz (works without JS; JS turns options into buttons and checks the answer):

```html
<div class="quiz">
  <p class="q">Who decides to call the model again? (Q3)</p>
  <ol class="options">
    <li>The model</li>
    <li data-correct>The runtime loop</li>
    <li>The tool</li>
  </ol>
  <details class="answer"><summary>Answer</summary><p>The runtime loop. ...</p></details>
</div>
```

An open question is the same without `<ol class="options">`. The chapter 00 "who does what" sorter is a list of quizzes with options Model / Runtime / Both.

Exercise or checkpoint (the textarea autosaves; JS adds a saved/unavailable status and a Copy button):

```html
<article class="exercise" id="ex-competitors">
  <h2>Competitor report every Monday</h2>
  <p>Scenario...</p>
  <ol><li>What tools does it need?</li></ol>
  <label for="ex-competitors-notes">Your design</label>
  <textarea id="ex-competitors-notes" class="ex-notes" rows="8"></textarea>
  <details class="reveal"><summary>Reveal one reasonable architecture</summary>...</details>
</article>
```

## Widgets

Contract:
- Mount point: `<div class="widget" data-widget="NAME" data-...><p class="noscript">Fallback that teaches the lesson in text.</p></div>`.
- File `docs/assets/widgets/NAME.js`, optional `NAME.css` linked in the head after `site.css`.
- The file is an IIFE that touches no DOM at load time:

```js
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};
  AC.widgets = AC.widgets || {};
  AC.sims = AC.sims || {};

  AC.sims['NAME'] = { /* pure logic, no DOM: tested by tools/sims/NAME.test.mjs */ };

  AC.widgets['NAME'] = function (root) {
    // options from root.dataset; all state local to this call
  };
})();
```

- `site.js` mounts every `[data-widget]` on DOMContentLoaded inside try/catch, then sets `data-widget-status` to `ok` or `error`. Clear `root` before rendering. Several instances on one page must work (use `AC.uid('prefix')` for ids).
- Helpers from `site.js`: `AC.h(tag, attrs, ...children)` builds elements (attrs: `class`, `text`, `html` (trusted strings only), `on: {click: fn}`, `aria-*`, `data-*`, anything else as an attribute); `AC.uid(prefix)`; `AC.store.get/set` (never touch localStorage directly). `stepper.js` provides `AC.stepper(opts)` for step-through flows.
- Use shared classes from `site.css` before inventing new ones: `w-frame`, `w-head`, `w-title`, `w-sub`, `w-body`, `w-controls`, `w-btn` (`primary`), `w-tabs` with `w-tab` (`aria-selected`), `w-grid` (`cols-2`, `cols-3`), `w-panel` with `w-panel-title`, `w-kv`, `w-log`, `w-bar` with `w-seg`, `w-toggle`, `w-card`, `w-note`, `w-warn`, `w-pill`, `badge`, `w-json`, `w-narration`, `w-counter`. Role colors: `--model`, `--runtime`, `--tool`, `--state`, `--context`, `--human` (strong) and `--model-bg` and so on (tints).

Accessibility:
- Controls are `<button>`, `<input>`, or `<select>` with visible labels.
- Re-render panels, not the controls that have focus.
- Step narration goes in an `aria-live="polite"` region (the stepper provides one). Keep it to one or two sentences.
- Arrow keys only when focus is on the widget's own step buttons, never inside inputs or sliders.
- Autoplay is off by default and disabled under `prefers-reduced-motion`.
- SVG diagrams get `role="img"` and an `aria-label`. The narration and logs are the text equivalent.
- Works at 360px wide.
- Numbers (tokens, costs, scores, timings) are illustrative. Say so once in the widget.

Tests (write them first):

```js
// tools/sims/NAME.test.mjs
export default function (sims, assert) {
  const s = sims['NAME'];
  // assert the lesson's invariants, e.g. a rejected call never executes
  assert.equal(s.run({ choice: 'reject' }).executed.includes('drop'), false);
}
```

Run `node tools/test-sims.mjs`.

## Running example: Patch

Patch is a coding agent for a small team's web service (Python API, PostgreSQL, deployed on AWS; TypeScript front end). It grows one capability per chapter:

| ch | what Patch gains |
|---|---|
| 00 | Nothing yet: a single model call. You paste code, it suggests a fix. No agency. |
| 01 | A loop: run requested tools, call again, stop on a final answer or after 30 steps. |
| 02 | Tools: `search_files`, `read_file`, `edit_file`, `run_command`, with effect classes and validation errors returned to the model. |
| 03 | A state object: messages, status, step, files read, files changed, test results, approvals. |
| 04 | A context builder: stable prefix (system, tools, AGENTS.md), then history; long tool outputs saved to files with a short preview; compaction near the window limit. |
| 05 | Memory: a project memory file (PostgreSQL, TypeScript front end, conventions), episodic notes from past fixes, retrieval on demand. |
| 06 | A todo list tool; plan approval for large changes; a review pass that checks the diff against test results. |
| 07 | Subagents: a read-only explorer that searches the codebase and returns a summary; a reviewer with no write tools. |
| 08 | Skills: `add-db-migration` and `deploy-staging` packages loaded on demand. |
| 09 | The full coding loop on the failing auth test. |
| 10 | A sandbox: container with only the repo mounted, egress limited to the package registry, no production credentials. |
| 11 | Approval gates: push, migrations on shared databases, deploys, deleting files outside the repo. |
| 12 | Nightly runs from a queue: checkpoint per step, one PR per issue key (deduplicated by the Git host lookup), retries with backoff. |
| 13 | Communication: subagents return summaries and write details to files in a shared workspace. |
| 14 | Architecture: single agent plus helper subagents; why not a hierarchy. |
| 15 | Reliability guards: loop detector, step and cost budgets, test-gated "done". |
| 16 | An eval suite: 50 past bugs replayed in containers, several trials each; cost and intervention rate tracked. |
| 17 | How you would build Patch on Hermes, Deep Agents, or Pi. |
| 18 | When Patch got better, which lever caused it. |
| 19 | Which Patch decisions you made and which code the AI wrote. |
| 21 | Patch's full design brief: the course's target sentence. |

The expense agent is the second running example, used only in design checkpoints (`notes/checkpoints.md`).

## Checks

- `python3 tools/check.py docs/YOUR-PAGE.html` while writing. It must print no errors for your pages.
- `node tools/test-sims.mjs` if you wrote a widget.
- `node --check docs/assets/widgets/YOUR-WIDGET.js`.
- `python3 tools/check.py --all` runs the global checks (all pages, requirement anchors, cross-page links). It only passes once every page exists.
