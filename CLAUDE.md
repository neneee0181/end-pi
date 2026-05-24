# CLAUDE.md

This is the Claude Code entry file for the project.

<!-- memoc:managed:start -->
## Session Start
- [ ] Read `.memoc/session-summary.md`
- [ ] `.pending` exists? Review changed files, update memory if needed, then delete it.
- [ ] If `memoc` is not found, use the project-local wrapper for the rest of the session: Windows `.\.memoc\bin\memoc.cmd <command>`; sh `.memoc/bin/memoc <command>`

## Before Opening More Files
- [ ] Search memory first: `memoc search "<query>" --limit 5`, or wrapper fallback above if PATH fails
- [ ] Open on demand: `02` status, `04` resume, `06` rules, `llms.txt` map
- [ ] If memory search is not enough, search project files with `memoc grep "<query>" --limit 5` (or wrapper fallback)
- [ ] If asked to refresh/update memoc project memory, run `memoc update` first; this refreshes managed sections, wiki links, and Obsidian tags.
- [ ] For durable source material use `memoc ingest <path-or-url>`; for durable analysis/query results use `memoc note "<title>"`; after wiki edits run `memoc lint-wiki`.
- [ ] In shared repos, record meaningful work with `memoc work "<title>"`; actor defaults to `MEMOC_ACTOR`, local actor, git user, git email, or OS user.
- [ ] Keep output small: `summary`, `search --limit`, `grep --limit`, `--snippets`

## Before Finishing _(update only applicable files; skip Q&A / throwaway exploration)_
- [ ] Code/config/deps changed? Update `02` + `session-summary.md`
- [ ] Decision made? Update `03-decisions.md` + `02`
- [ ] Work incomplete or risky? Update `04-handoff.md`
- [ ] Rule/preference set? Update `06-project-rules.md`
- [ ] Wiki/project-memory work? Read `skills/project-memory-maintainer/SKILL.md`
- [ ] User asked to update memoc/project memory? Run `memoc update`, then update the smallest relevant agent-owned memory files.
- [ ] Shared repo work? Prefer `memoc work "<title>" --from-git` over appending shared files; run `memoc activity --write` only when regenerating indexes.
- [ ] Keep `session-summary.md` as a replace-only snapshot under 800B; move completed work to actor worklogs and resume risks to `04-handoff.md`. If it grew, run `memoc trim-summary`.
<!-- memoc:managed:end -->
