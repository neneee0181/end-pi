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
# memoc Usage

This project uses `memoc` to maintain agent-readable project memory.

## Commands

```bash
# Optional: put the project-local wrapper first in PATH for this shell
# PowerShell: . .\.memoc\env.ps1
# sh/bash:    . ./.memoc/env.sh

# First-time setup (or re-run to update managed sections)
memoc init

# Refresh memoc itself when run through npx @latest, preserving project memory
memoc upgrade

# Explicitly update managed sections based on current project state
memoc update
memoc trim-summary

# Shared repo actor/work tracking
memoc actor
memoc actor set neneee
memoc work "Auth refresh fix" --from-git
memoc activity
memoc activity --write
memoc doctor

# Tiny status overview
memoc summary

# Search memory first; add --snippets only when needed
memoc search "<query>" --limit 12
memoc search "<query>" --snippets --limit 5

# Search project source/text files when memory is not enough
memoc grep "<query>" --limit 12
memoc grep "<query>" --snippets --limit 5

# Wiki operations
memoc ingest <path-or-url>
memoc note "Durable topic or query result"
memoc lint-wiki
```

If `memoc` is not on PATH, use `.\.memoc\bin\memoc.cmd <command>` on Windows or `.memoc/bin/memoc <command>` in sh for the rest of the session. If the local wrapper is missing, use `npx @kevin0181/memoc <command>` or re-run init.

## Agent Read Order

1. Entry-file managed block.
2. `.memoc/session-summary.md` only.
3. Search memory first with one or two concrete terms: `memoc search "<query>" --limit 5`.
4. Open only the matching memory file(s) that matter.
5. If memory is not enough, search project files: `memoc grep "<query>" --limit 5`.
6. Use `--snippets` only when file names are not enough.

Use `memoc search` for known concepts, changed areas, decisions, tasks, or handoff notes. Skip it for brand-new questions where no prior memory can exist.

Raw files under `.memoc/raw/` are intentionally not part of normal memory search. Open them only through a linked source record when provenance is needed.

## Shared Repo Activity

Use `memoc work "<title>" --from-git` to create conflict-light activity records under `.memoc/worklog/<actor>/YYYY-MM/`. The command prefills actor, branch, timestamp, and changed files from git so agents only need to fill short Summary/Verification notes when useful. Actor is detected in this order: `MEMOC_ACTOR`, `.memoc/local/actor`, `git config user.name`, `git config user.email`, OS username. Use `memoc actor set <name>` to store a local actor name without committing it.

`.memoc/activity.md`, `.memoc/worklog/README.md`, and `.memoc/actors/README.md` are regenerated indexes. Run `memoc activity --write` to rebuild them from worklog/actor files instead of appending to them during every task.

## When To Run Memory Updates

Use `memoc update` or `skills/project-memory-maintainer/SKILL.md` when:

- The user asks to update memoc, refresh project memory, sync project memory, or "update the project in memoc".
- Requirements, acceptance criteria, user preferences, or project rules changed.
- Source code, config, data, content, or package scripts changed.
- Architecture, data flow, routing, auth, or deployment behavior changed.
- A decision was made that future agents should not revisit blindly.
- Work is partial, multi-step, blocked, or likely to be resumed by another agent.
- New implementation knowledge belongs in `.memoc/wiki/project/`.
- Source-backed concept knowledge belongs in `.memoc/wiki/knowledge/`.
- Shared work should be traceable without causing conflicts.

Usually skip for pure Q&A, throwaway exploration, or tiny edits with no future impact.

When the user asks for a general memoc/project-memory refresh, run `memoc update` first. It refreshes managed sections, reconnects default wiki scaffold links, and applies Obsidian frontmatter tags. Then update only the agent-owned files whose content actually changed, such as `.memoc/session-summary.md`, `.memoc/02-current-project-state.md`, `.memoc/04-handoff.md`, `.memoc/wiki/index.md`, project/knowledge wiki pages, or actor worklogs.

`.memoc/session-summary.md` is a startup snapshot, not a timeline. Rewrite it in place, do not append old work. If it exceeds 800B, run `memoc trim-summary`; it archives the previous summary and rewrites a compact version. Put completed history in actor worklogs, and put unfinished/risky resume detail in `.memoc/04-handoff.md`.

## Updating The Wiki

Create wiki pages under the right layer when knowledge should compound across sessions.

- `.memoc/raw/`: immutable source material copied or referenced by `memoc ingest`.
- `.memoc/wiki/project/`: implementation docs for this repo.
- `.memoc/wiki/knowledge/sources/`: provenance records.
- `.memoc/wiki/knowledge/topics/`: synthesized topic pages.
- `.memoc/wiki/knowledge/global/`: broader source-backed principles.

After creating or editing wiki pages:
1. Update `.memoc/wiki/index.md`.
2. Run `memoc lint-wiki`.
3. If the change is meaningful shared work, run `memoc work "<title>" --from-git`.

Useful scaffolds:

```bash
memoc ingest path/to/source.md
memoc ingest https://example.com/spec
memoc note "Auth flow comparison"
memoc lint-wiki
```

## Updating System Docs

Create or update `.memoc/wiki/project/*.md` when a subsystem needs durable implementation detail.

Examples: `frontend.md`, `deployment.md`, `data-sources.md`, `auth.md`
