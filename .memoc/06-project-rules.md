---
memoc: true
type: state
scope: project-memory
created: 2026-05-24T12:01:02
updated: 2026-05-24T12:01:02
status: active
tags:
  - memoc
  - memoc/state
---
# Project Rules

Durable user and project preferences live here. Update when the user gives a rule that should persist across sessions.

## Operating Rules

- Keep `AGENTS.md` and `CLAUDE.md` as short entry files; durable context belongs under `.memoc/`.
- Do not track generated output folders such as `out/`, `.next/`, `dist/`, `build/` unless the user explicitly asks.
- Update `.memoc/04-handoff.md` after substantial work so the next agent can resume quickly.
- Use `.memoc/05-done-checklist.md` before saying substantial work is complete.

## Agent Behavior Preferences

- Be factual and operational in memory docs.
- Keep memory notes concise; do not paste temporary command output unless it changes future work.
- Preserve user changes and avoid reverting unrelated work.
- State unverified parts honestly in the final answer and handoff.

## Project-Specific Rules

_None yet._
