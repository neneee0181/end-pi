# end-pi troubleshooting

## First command

```bash
ep doctor
```

If Codex is already in `end-pi` mode and the proxy looks broken:

```bash
ep doctor --fix
```

## Codex reconnects forever

Check:

```bash
ep logs --last-request
ep logs --lines=200
ep doctor
```

Common causes:

- Selected Pi provider token expired.
- Selected model does not support tools or images.
- Provider stream ended without output.
- Another process occupied the old proxy port.

## `localhost:3141` shows another app

`end-pi` uses `3141` by default, but picks another nearby free port when needed.

Check selected endpoint:

```bash
ep --status
```

Then open:

```text
http://localhost:<port>/health
```

Expected response includes:

```json
{ "service": "end-pi" }
```

## Tools do not run

Use:

```bash
ep logs --last-request
```

Look for recent `function_call` entries. If no tool calls appear, the selected provider/model may not follow tool instructions well. Try another Pi model.

## Search says something is absent but you know it exists

Ask with broader names, or include likely directory names. `end-pi` also nudges models to broaden exact failed searches with case variants, file-name search, and likely subdirectories.

## Images are not understood

Confirm:

- Model supports vision.
- Request log shows `[image-data:...]` in `~/.codex/end-pi-requests`.
- The selected provider accepts Pi image content.

## `ep --restore` does not reopen Codex

Run:

```bash
ep doctor
```

If launch target is not detected, open Codex Desktop manually once, then rerun `ep`.

## Multi-pass commands missing

Run:

```bash
ep setup
ep --status
```

If installing from a custom git source:

```bash
END_PI_MULTIPASS_GIT=git:github.com/<owner>/<repo> ep setup
```

## Manual recovery

Restore native Codex:

```bash
ep --restore
```

If needed, inspect backups in:

```text
~/.codex/
```

`end-pi` creates config and database backups before migration.
