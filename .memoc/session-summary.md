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
# Session Summary
Last: 2026-05-24T22:50:00+09:00
Replace this file instead of appending to it. Keep total size <800B and each section ≤3 bullets.
Completed history belongs in actor worklogs; incomplete/risky resume detail belongs in `04-handoff.md`.
Agent-owned — updated by you, not by `memoc update`.

## Status
- end-pi dev linked locally; version now 0.0.13.
- Proxy bridges Codex Responses tools to Pi and logs requests under `~/.codex/end-pi-requests`.

## Changed
- Added provider stream error/done handling so empty provider output returns a visible end-pi error instead of Codex reconnect loops.
- Annotates failing/unproductive tool outputs so models stop polling stuck commands and choose an available fallback.

## Open Tasks
- Retest Codex Desktop ep mode with project-search/tool calls after restarting ep.

## Resume
- If issue persists, inspect latest `~/.codex/end-pi.log` and matching request JSON around the failing timestamp.
