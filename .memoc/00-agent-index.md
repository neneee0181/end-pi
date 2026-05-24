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
# Agent Index

This is the fast entry map for agents. Start here, then open only the docs relevant to the task.

## Read Order

1. Entry file managed block.
2. `.memoc/session-summary.md`.
3. Search first, then open only task-relevant files.

## Project Snapshot

<!-- memoc:snapshot:start -->
- Last synced: 2026-05-24T12:01:02
- Detected stack: Node.js, Hono, TypeScript

### Config Files

- `package.json`
- `tsconfig.json`

### Source Directories

- `assets`
- `src`

### Package Scripts

- `dev`: `tsx src/index.ts`
- `build`: `tsc`
- `prepack`: `npm run build`
- `start`: `node dist/index.js`
<!-- memoc:snapshot:end -->

## Core Docs

- [Boot](boot.md)
- [Project Brief](00-project-brief.md)
- [memoc Usage](memoc-usage.md)
- [Agent Workflow](01-agent-workflow.md)
- [Current Project State](02-current-project-state.md)
- [Decisions](03-decisions.md)
- [Handoff](04-handoff.md)
- [Done Checklist](05-done-checklist.md)
- [Project Rules](06-project-rules.md)
- [Session Summary](session-summary.md)
- [Activity](activity.md)
- [Actors](actors/README.md)
- [Worklog](worklog/README.md)
- [Wiki Index](wiki/index.md)
- [Project Wiki](wiki/project/README.md)
- [Knowledge Wiki](wiki/knowledge/README.md)
- [Raw Sources](raw/README.md)

## Wiki

- [Wiki Index](wiki/index.md) — hub for project and knowledge wikis.
- [Project Wiki](wiki/project/README.md) — implementation docs for this repo.
- [Knowledge Wiki](wiki/knowledge/README.md) — source-backed concepts and external knowledge.
- [Sources](wiki/knowledge/sources.md) — source provenance and ingest notes.
- [Glossary](wiki/knowledge/glossary.md) — terms and aliases.
- [Open Questions](wiki/knowledge/questions.md) — unresolved knowledge gaps.
- [Wiki Lint](wiki/knowledge/lint.md) — orphan, stale, and contradiction checks.
