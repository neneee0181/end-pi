# end-pi troubleshooting

## First command

```bash
ep doctor
ep doctor --json
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
- API-key providers must be read as Pi `api_key` auth entries, not OAuth providers.
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

If logs are noisy or too old:

```bash
ep logs --clean --keep=100
```

## Search says something is absent but you know it exists

Ask with broader names, or include likely directory names. `end-pi` also nudges models to broaden exact failed searches with case variants, file-name search, and likely subdirectories.

## Images are not understood

Confirm:

- Model supports vision.
- Request log shows `[image-data:...]` in `~/.codex/end-pi-requests`.
- The selected provider accepts Pi image content.

## Automated checks

For local development, run:

```bash
npm test
ep smoke --matrix
```

`npm test` checks the Codex-to-Pi transform layer. `ep smoke --matrix` prints a provider checklist for manual verification across Pi models.

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

Normal `ep` also checks for newer npm releases of `end-pi-multi-pass` when the companion is already installed. To skip that check:

```bash
EP_SKIP_MULTIPASS_UPDATE=1 ep
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
