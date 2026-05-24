# end-pi regression checklist

Run these after release changes or provider/tool bridge changes.

## CLI health

```bash
ep --version
ep --status --no-update
ep doctor --no-update
ep smoke --no-update
ep logs --last-request
```

Expected:

- Version matches `package.json`.
- Doctor shows Node, Pi CLI, Codex config, Pi auth, Pi model, endpoint, and logs.
- `ep logs --last-request` prints a summary without secrets.

## Switch flow

```bash
ep --restore
ep
ep --status
```

Expected:

- Codex closes and reopens.
- `ep --status` shows `Proxy: active`.
- Endpoint points to the selected local port.
- `http://localhost:<port>/health` returns `{ "service": "end-pi" }`.

## Tool bridge

In Codex Desktop while `end-pi` is active, ask:

```text
Find where AGENTS.md is and summarize its top-level instructions.
```

Expected:

- Model uses file/search tools.
- Final answer cites real workspace files.
- No repeated polling of stuck commands.

## Search miss recovery

Ask a project-specific question using an approximate symbol name.

Expected:

- Model broadens search after exact miss.
- It tries case variants, file-name search, or likely subdirectories before saying absent.

## Image input

Attach a small image and ask:

```text
What text is visible in this image?
```

Expected:

- Request log contains `[image-data:...]`, not raw base64.
- Selected Pi model receives Pi image parts.
- Vision-capable model answers from image content.

## Provider matrix

Repeat one short tool task and one image task after switching Pi `/model` across:

- Claude/Anthropic-compatible provider
- OpenAI/Copilot-compatible provider
- Gemini/Google-compatible provider
- Antigravity provider, if authenticated

Expected:

- Text-only tool task works across providers with tool support.
- Image task works only on vision-capable models.
- Provider errors surface in Codex instead of reconnect loops.

## Restore flow

```bash
ep --restore
ep --status
```

Expected:

- Codex returns to native provider.
- Conversation history remains available.
- Proxy daemon stops.
