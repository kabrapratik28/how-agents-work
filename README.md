# How AI Agents Work

An interactive course on how modern AI agents work, concept by concept. It is for engineers who want to design agent systems and direct an AI coding system to build them, without memorizing framework APIs.

Every chapter extends one loop: State, Build context, Call model, Model decides, Runtime acts, Update state, repeat. Real systems (Hermes, LangChain Deep Agents, Pi, OpenHands, the OpenAI Agents SDK, LangGraph, PydanticAI, smolagents, and others) appear as case studies.

## Read it

- Online: GitHub Pages serves the `docs/` folder.
- Locally, the reliable way: `cd docs && python3 -m http.server 8000`, then open http://localhost:8000.
- Opening `docs/index.html` straight from disk also works, but some browsers block saved progress and exercise notes on `file://` pages.

Progress, ticks, and exercise notes are stored in your browser's localStorage only.

## What is in it

- 22 chapters plus a comparison table, the 31-question self-test, and a glossary.
- Interactive widgets: a step-through agent loop, tool-call anatomy, a context builder, a memory simulator, a subagent simulator, skill loading, a sandbox threat simulator, crash-and-resume, an architecture explorer, and a framework comparison table.
- Design checkpoints at the end of each part, and ten architecture exercises with reference designs.

## Work on it

- Conventions for pages and widgets: `AUTHORING.md`.
- Static checks (structure, links, writing rules): `python3 tools/check.py` (add `--all` for completeness checks).
- Widget logic tests: `node tools/test-sims.mjs`.
- Browser smoke test: `cd tools && npm install`, then `node tools/smoke.mjs` (add `--screens` for screenshots in `notes/screens/`). It uses Playwright's own Chromium, or `CHROMIUM_PATH` if set.

The site has no build step and no runtime dependencies: plain HTML, CSS, and JavaScript.
