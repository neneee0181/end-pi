---
name: project-memory-maintainer
description: Maintain this project's LLM-wiki memory files after durable context changes.
memoc: true
type: skill
scope: project-memory
updated: 2026-05-24T12:01:02
created: 2026-05-24T12:01:02
status: active
tags:
  - memoc
  - memoc/skill
---
# Project Memory Maintainer

Use this local skill after meaningful project work so future agents can continue without rediscovering context.

## Required Reads

1. `.memoc/session-summary.md`
2. `memoc summary` or `memoc search "<query>"`; use `memoc grep "<query>"` only when source/text search is needed
3. Open only files you will use or update.

## Maintenance Checklist

- If the user asked to update/refresh memoc project memory, run `memoc update` first so managed sections, wiki scaffold links, and Obsidian tags are current.
- Keep `llms.txt` and `.memoc/00-agent-index.md` as concise maps.
- Keep `.memoc/00-project-brief.md` as the shortest project summary.
- Rewrite `.memoc/session-summary.md` as the latest snapshot only; never append a timeline. If it is over 800B, run `memoc trim-summary`.
- Update `.memoc/02-current-project-state.md` with new status, tasks, commands, and change log entries.
- Update `.memoc/03-decisions.md` when a durable decision is made.
- Update `.memoc/04-handoff.md` before ending substantial work.
- Check `.memoc/05-done-checklist.md` before saying substantial work is complete.
- Update `.memoc/06-project-rules.md` when the user gives durable preferences.
- Create a short actor worklog with `memoc work "<title>" --from-git` for meaningful changes, decisions, and handoffs.
- Create or update `.memoc/wiki/project/*.md` when a subsystem needs durable implementation explanation.
- Create or update `.memoc/wiki/knowledge/*.md` when source-backed concepts should compound over time.
- Use `memoc ingest <path-or-url>` for source material and `memoc note "<title>"` for durable query results or analysis.
- Use `memoc work "<title>" --from-git` for meaningful shared-repo work so details are saved in actor-scoped worklog files instead of causing shared-file conflicts.
- Keep the wiki graph connected: update `.memoc/wiki/index.md`, link project pages under `.memoc/wiki/project/`, link knowledge pages under `.memoc/wiki/knowledge/`, and include a `## Related` section on every new wiki page.
- Run `memoc lint-wiki` after wiki/source/topic edits and address broken links before finishing.
- Keep completed history in actor worklogs; keep current-state files short.
- Move completed session details out of `session-summary.md` into `.memoc/worklog/<actor>/YYYY-MM/`; move incomplete/risky resume details into `04-handoff.md`.
- In shared repos, do not use `log.md`; prefer new files under `.memoc/worklog/<actor>/YYYY-MM/` and regenerate `.memoc/activity.md` with `memoc activity --write`.
- Keep tool output small; prefer `summary`, file-only search, `--limit`, and targeted reads.

## Wiki Link Rules

- Use relative Markdown links that Obsidian can follow, for example `[Project Wiki](project/README.md)` or `[Topics](knowledge/topics/README.md)`.
- Every wiki page must have at least one inbound link from `wiki/index.md`, a directory README, a source page, project page, or related topic.
- Every wiki page must link outward to its parent hub plus 1-5 genuinely related pages when they exist.
- Prefer links in normal prose when the connection is meaningful; use `## Related` for compact navigation.
- When a concept appears in multiple pages, create or update a topic/glossary page and link all mentions to it.
- After wiki edits, check `.memoc/wiki/knowledge/lint.md` and note orphan pages, missing backlinks, contradictions, or stale claims.

## Concrete Triggers

Use this skill before finishing when any of these are true:

- The user gives a durable preference, project rule, changed requirement, or acceptance criterion.
- The agent edits code, config, package scripts, env, data, assets, routes, or deployment files.
- A subsystem's behavior, architecture, data flow, or API contract changes.
- A future agent would need to know why an approach was chosen or rejected.
- The work is partial, blocked, risky, multi-step, or likely to be resumed later.

Usually skip for pure Q&A, tiny edits with no future impact, or throwaway exploration.
