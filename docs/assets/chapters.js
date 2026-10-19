/* Course manifest: the single source of truth for navigation. The blocks between the markers are strict JSON (tools/check.py parses them). */
(function () {
  'use strict';
  var AC = window.AC = window.AC || {};

  AC.parts = /*PARTS*/[
    {"id": "p0", "title": "Start here", "blurb": "What separates a model from an agent."},
    {"id": "p1", "title": "The core loop", "blurb": "The loop, its tools, its state, and what the model sees."},
    {"id": "p2", "title": "Capabilities built on the loop", "blurb": "Memory, planning, subagents, skills, and coding agents."},
    {"id": "p3", "title": "Control and safety", "blurb": "What the agent can touch, and when a person decides."},
    {"id": "p4", "title": "Systems", "blurb": "Long-running work, communication, and architecture."},
    {"id": "p5", "title": "Quality", "blurb": "How agents fail and how to measure them."},
    {"id": "p6", "title": "Real systems", "blurb": "Hermes, Deep Agents, Pi, and others as case studies."},
    {"id": "p7", "title": "Thinking like a designer", "blurb": "Attribute gains, own the decisions, practice designs."},
    {"id": "ref", "title": "Reference", "blurb": "Self-test and glossary."}
  ]/*END*/;

  AC.chapters = /*CHAPTERS*/[
    {"file": "00-llm-vs-agent.html", "num": "00", "label": "Chapter 0", "title": "LLM vs agent", "part": "p0", "short": "The model computes. Your code acts. Where intelligence ends and agency begins."},
    {"file": "01-agent-loop.html", "num": "01", "label": "Chapter 1", "title": "The agent loop", "part": "p1", "short": "Observe, decide, act, repeat. The loop every agent runs, and how it ends."},
    {"file": "02-tools.html", "num": "02", "label": "Chapter 2", "title": "Tools", "part": "p1", "short": "A tool call is a structured request. The runtime decides whether and how to run it."},
    {"file": "03-state.html", "num": "03", "label": "Chapter 3", "title": "State", "part": "p1", "short": "Conversation, runtime state, world state, persistent state. Who holds what."},
    {"file": "04-context.html", "num": "04", "label": "Chapter 4", "title": "Context", "part": "p1", "short": "The model sees only what you put in front of it. Choosing that is the central design problem."},
    {"file": "05-memory.html", "num": "05", "label": "Chapter 5", "title": "Memory", "part": "p2", "short": "Storage, a write policy, retrieval, and injection. Not the model remembering."},
    {"file": "06-planning.html", "num": "06", "label": "Chapter 6", "title": "Planning and reflection", "part": "p2", "short": "A plan is a maintained list of intended actions. Reflection is another model call."},
    {"file": "07-subagents.html", "num": "07", "label": "Chapter 7", "title": "Subagents", "part": "p2", "short": "Another loop with its own context. When delegation helps and when it costs too much."},
    {"file": "08-skills.html", "num": "08", "label": "Chapter 8", "title": "Skills", "part": "p2", "short": "Six things people call a skill, and what each reduces to."},
    {"file": "09-coding-agents.html", "num": "09", "label": "Chapter 9", "title": "Coding agents", "part": "p2", "short": "A few file and shell tools, a fast feedback loop, and a capable model."},
    {"file": "10-sandboxing.html", "num": "10", "label": "Chapter 10", "title": "Sandboxing", "part": "p3", "short": "Instructions, gates, containment, external controls. Which one actually stops the attack."},
    {"file": "11-human-in-the-loop.html", "num": "11", "label": "Chapter 11", "title": "Human in the loop", "part": "p3", "short": "Pause, persist, ask, resume. Approval bound to one exact action."},
    {"file": "12-long-running.html", "num": "12", "label": "Chapter 12", "title": "Long-running agents", "part": "p4", "short": "Checkpoints, queues, retries, idempotency. Agents turn into distributed systems."},
    {"file": "13-communication.html", "num": "13", "label": "Chapter 13", "title": "Agent communication", "part": "p4", "short": "Shared state, messages, events, queues, return values, blackboards, databases."},
    {"file": "14-architectures.html", "num": "14", "label": "Chapter 14", "title": "Agent architectures", "part": "p4", "short": "From one agent to hierarchies, as composable choices with costs."},
    {"file": "15-reliability.html", "num": "15", "label": "Chapter 15", "title": "Reliability", "part": "p5", "short": "Thirteen ways agents fail: why, how to detect it, how to mitigate it."},
    {"file": "16-evaluation.html", "num": "16", "label": "Chapter 16", "title": "Evaluation", "part": "p5", "short": "Measuring whole runs, not single answers."},
    {"file": "17-case-studies.html", "num": "17", "label": "Chapter 17", "title": "Framework case studies", "part": "p6", "short": "Hermes, Deep Agents, Pi, and others. Which general ideas each one implements."},
    {"file": "17b-comparison.html", "num": "17b", "label": "Chapter 17b", "title": "Comparison table", "part": "p6", "short": "The same concepts side by side across systems."},
    {"file": "18-model-vs-architecture.html", "num": "18", "label": "Chapter 18", "title": "Model capability vs agent architecture", "part": "p7", "short": "When an agent gets better, which lever caused it?"},
    {"file": "19-what-you-design.html", "num": "19", "label": "Chapter 19", "title": "What AI builds vs what you design", "part": "p7", "short": "The decisions you own even when AI writes all the code."},
    {"file": "20-exercises.html", "num": "20", "label": "Chapter 20", "title": "Architecture exercises", "part": "p7", "short": "Ten design scenarios, each with one reasonable architecture."},
    {"file": "21-design-brief.html", "num": "21", "label": "Chapter 21", "title": "The design brief", "part": "p7", "short": "Decode the target sentence. Write a brief an AI coding system can build from."},
    {"file": "questions.html", "num": "Q", "label": "Reference", "title": "The 31 questions", "part": "ref", "short": "Self-test with answers and links back to the chapters."},
    {"file": "glossary.html", "num": "G", "label": "Reference", "title": "Glossary", "part": "ref", "short": "Every term reduced to primitives."}
  ]/*END*/;
})();
