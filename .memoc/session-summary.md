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
Last: 2026-05-24T23:25:00+09:00

## Status
- Version 0.0.17 in progress.
- Proxy bridges Codex Responses tools to Pi; logs under `~/.codex/end-pi-requests`.

## Changed
- Generalized proxy port selection, Codex provider config rewriting, and multi-pass detection.
- Removed user/tool-specific stuck-command guidance.
- Added generic no-match search guidance so models broaden exact failed searches before concluding absent.
- Preserved developer/system instructions as Pi system context and exposed Codex namespace tools via aliases.

## Open Tasks
- Build, pack, commit, tag, push.

## Resume
- Retest `ep`; `ep --status` should show selected endpoint.
