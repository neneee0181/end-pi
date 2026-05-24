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
# Agent Boot

On-demand reference only. The entry-file managed block is authoritative.

## Open Only When Needed

| File | When to open |
| --- | --- |
| `.memoc/session-summary.md` | Every session start (only required read) |
| `.memoc/02-current-project-state.md` | Before changing behavior or checking tasks |
| `.memoc/04-handoff.md` | When resuming incomplete work |
| `.memoc/06-project-rules.md` | When unsure about preferences or conventions |
| `.memoc/01-agent-workflow.md` | When update routing is unclear |
| `.memoc/05-done-checklist.md` | Before finishing substantial work |
| `.memoc/03-decisions.md` | When a durable decision was made |
| `.memoc/memoc-usage.md` | For command details |
| `.memoc/wiki/project/*.md` | Before touching a specific subsystem |
| `.memoc/wiki/knowledge/*.md` | For source-backed concepts and external knowledge |
| `llms.txt` | For full project file map |

## Search First

`memoc search "<query>"` — returns file:line matches across memory and agent docs only.
`memoc grep "<query>"` — searches project source/text files when memory docs are not enough.
If `memoc` is not on PATH, try `.\.memoc\bin\memoc.cmd search "<query>"` on Windows or `.memoc/bin/memoc search "<query>"` in sh, then `npx @kevin0181/memoc search "<query>"`.
Use it before opening any file to avoid reading more than needed.
