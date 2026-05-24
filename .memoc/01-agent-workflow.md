---
memoc: true
type: core
scope: project-memory
created: 2026-05-24T12:01:02
updated: 2026-05-24T12:01:02
status: active
tags:
  - memoc
  - memoc/core
---
# Agent Workflow

Shared protocol for any coding agent.

## Entry Routine

1. Read the entry-file managed block.
2. Read `.memoc/session-summary.md` only.
3. Search before opening broad docs.
4. Work from the smallest relevant file set.
5. Update memory only when durable context changed.

## Memory Update Triggers

| Trigger | Update |
| --- | --- |
| User asks "update memoc", "refresh project memory", or similar | Run `memoc update` first, then update relevant agent-owned memory files |
| User creates or changes a requirement | `02-current-project-state.md`, `06-project-rules.md`, `memoc work "<title>" --from-git` |
| Code, config, data, or assets changed | `02-current-project-state.md`, relevant `wiki/project/*.md`, `memoc work "<title>" --from-git` |
| Architecture or system behavior changed | relevant `wiki/project/*.md`, `03-decisions.md` |
| A decision should affect future agents | `03-decisions.md`, `02-current-project-state.md` |
| Work is substantial enough to resume later | `04-handoff.md`, `02-current-project-state.md`, `memoc work "<title>" --from-git` |
| Durable project implementation knowledge was learned | `wiki/project/*.md`, `wiki/index.md` |
| Source material should feed the wiki | `memoc ingest <path-or-url>`, then synthesize affected `wiki/knowledge/topics/*.md` |
| A useful query answer should persist | `memoc note "<title>"`, then link related sources/topics |
| Shared repo work should be traceable | `memoc work "<title>"`; avoid appending long details to shared core files |
| `session-summary.md` exceeds 800B or starts accumulating history | Run `memoc trim-summary`; move completed history to worklog, resume details to `04-handoff.md` |

## Usually No Update Needed

- Pure Q&A with no durable outcome.
- Tiny typo-only edits.
- Temporary exploration that finds nothing actionable.

## Documentation Shape

- Entry files: protocol only.
- `session-summary.md`: replace-only latest snapshot, <800B, max 3 bullets per section; never use as history.
- `02-current-project-state.md`: current status, tasks, commands, recent notes.
- `04-handoff.md`: resume context, blockers, verified/unverified checks.
- `03-decisions.md`: append durable decisions only.
- `worklog/<actor>/YYYY-MM/*.md`: actor-scoped append-by-new-file activity records for shared repos.
- `wiki/project/*.md`: repo implementation docs.
- `wiki/knowledge/*.md`: source-backed concepts, provenance, glossary, questions.
