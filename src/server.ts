import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import { getModel, stream as piStream } from "@earendil-works/pi-ai";
import type { Context as PiContext, Message, UserMessage, AssistantMessage } from "@earendil-works/pi-ai";
import { readPiAuth, readPiSettings, getAccessTokenForProvider } from "./pi-config.js";
import { createWriteStream } from "fs";
import { homedir } from "os";
import { join } from "path";

type PiUserContentPart = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

// Log to file, not stdout (Pi TUI owns stdout)
const logFile = createWriteStream(join(homedir(), ".codex", "end-pi.log"), { flags: "a" });
logFile.on("error", () => {
  // Keep the proxy alive even if the log file is locked or unavailable.
});
const writeLog = (prefix: string, args: unknown[]) => {
  if (logFile.destroyed) return;
  logFile.write(`[${new Date().toISOString()}] ${prefix}${args.join(" ")}\n`);
};
const log = (...args: unknown[]) => writeLog("", args);
const logErr = (...args: unknown[]) => writeLog("ERR ", args);

export const app = new Hono();

// GET /v1/models — returns single "pi" model mirroring current Pi selection
app.get("/v1/models", async (c) => {
  const settings = await readPiSettings();
  const provider = settings.defaultProvider ?? "unknown";
  const model = settings.defaultModel ?? "unknown";
  return c.json({
    object: "list",
    data: [
      {
        id: "end-pi",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: provider,
        description: `Pi current model — change with /model in Pi TUI`,
      },
    ],
  });
});

// POST /v1/responses  (wire_api = "responses")
app.post("/v1/responses", async (c) => {
  const body = await c.req.json();
  const isStreaming: boolean = body.stream ?? false;

  const { piModel, accessToken, info, error } = await resolvePiCurrentModel();
  if (error) return c.json({ error: { message: error } }, 503);

  log(`[ep] /v1/responses → ${info}`);

  const context = responsesInputToPiContext(body.input);
  const respId = `resp_${Date.now()}`;
  const itemId = `msg_${Date.now()}`;

  if (isStreaming) {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");

    return honoStream(c, async (stream) => {
      const send = async (event: string, data: unknown) =>
        stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      await send("response.created", {
        type: "response.created",
        response: makeResponse(respId, info, "in_progress"),
      });
      await send("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: { id: itemId, type: "message", role: "assistant", content: [], status: "in_progress" },
      });
      await send("response.content_part.added", {
        type: "response.content_part.added",
        item_id: itemId, output_index: 0, content_index: 0,
        part: { type: "output_text", text: "" },
      });

      let fullText = "";
      try {
        const eventStream = piStream(piModel!, context, { apiKey: accessToken });
        for await (const event of eventStream) {
          if (event.type === "text_delta") {
            fullText += event.delta;
            await send("response.output_text.delta", {
              type: "response.output_text.delta",
              item_id: itemId, output_index: 0, content_index: 0,
              delta: event.delta,
            });
          } else if (event.type === "error") {
            logErr(`[ep] stream error:`, (event as any).error?.errorMessage ?? event);
          }
        }
      } catch (e: any) {
        logErr(`[ep] piStream error:`, e.message);
        fullText = `[end-pi error] ${e.message}`;
      }

      await send("response.output_text.done", {
        type: "response.output_text.done",
        item_id: itemId, output_index: 0, content_index: 0, text: fullText,
      });
      await send("response.content_part.done", {
        type: "response.content_part.done",
        item_id: itemId, output_index: 0, content_index: 0,
        part: { type: "output_text", text: fullText },
      });
      await send("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item: { id: itemId, type: "message", role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" },
      });
      await send("response.completed", {
        type: "response.completed",
        response: {
          ...makeResponse(respId, info, "completed"),
          output: [{ id: itemId, type: "message", role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" }],
        },
      });
    });
  } else {
    const eventStream = piStream(piModel!, context, { apiKey: accessToken });
    const result = await eventStream.result();
    const text = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    return c.json({
      ...makeResponse(respId, info, "completed"),
      output: [{ id: itemId, type: "message", role: "assistant", content: [{ type: "output_text", text }], status: "completed" }],
      usage: { input_tokens: result.usage.input, output_tokens: result.usage.output, total_tokens: result.usage.totalTokens },
    });
  }
});

// POST /v1/chat/completions (fallback)
app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const { piModel, accessToken, info, error } = await resolvePiCurrentModel();
  if (error) return c.json({ error: { message: error } }, 503);

  log(`[ep] /v1/chat/completions → ${info}`);
  const context = openAiToPiContext(body.messages ?? []);
  const id = `chatcmpl-${Date.now()}`;

  if (body.stream) {
    c.header("Content-Type", "text/event-stream");
    return honoStream(c, async (stream) => {
      const eventStream = piStream(piModel!, context, { apiKey: accessToken });
      for await (const event of eventStream) {
        if (event.type === "text_delta") {
          await stream.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: info, choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }] })}\n\n`);
        }
      }
      await stream.write("data: [DONE]\n\n");
    });
  }
  const eventStream = piStream(piModel!, context, { apiKey: accessToken });
  const result = await eventStream.result();
  const text = result.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  return c.json({ id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: info, choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }], usage: { prompt_tokens: result.usage.input, completion_tokens: result.usage.output, total_tokens: result.usage.totalTokens } });
});

// Health + current model status
app.get("/health", async (c) => {
  const settings = await readPiSettings();
  return c.json({ status: "ok", service: "end-pi", currentModel: `${settings.defaultProvider}/${settings.defaultModel}` });
});

// --- Helpers ---

async function resolvePiCurrentModel() {
  const [settings, auth] = await Promise.all([readPiSettings(), readPiAuth()]);
  const provider = settings.defaultProvider;
  const modelId = settings.defaultModel;

  if (!provider || !modelId) {
    return { error: "Pi has no defaultProvider/defaultModel set. Use /model in Pi TUI.", piModel: null, accessToken: "", info: "" };
  }

  const authEntry = auth[provider];
  if (!authEntry) {
    return { error: `Provider "${provider}" not authenticated in Pi. Log in via Pi first.`, piModel: null, accessToken: "", info: "" };
  }

  let piModel: ReturnType<typeof getModel> | undefined;
  try {
    piModel = getModel(provider as any, modelId as any);
  } catch { /* ignore */ }

  if (!piModel) {
    const { getModels } = await import("@earendil-works/pi-ai");
    const available = getModels(provider as any);
    if (!available.length) return { error: `No models for provider "${provider}"`, piModel: null, accessToken: "", info: "" };
    piModel = available[0];
    log(`[ep] "${modelId}" not in pi-ai registry, fallback to "${piModel.id}"`);
  }

  try {
    const accessToken = await getAccessTokenForProvider(provider, auth);
    return { piModel, accessToken, info: `${provider}/${piModel.id}`, error: null };
  } catch (e: any) {
    return { error: e.message, piModel: null, accessToken: "", info: "" };
  }
}

function responsesInputToPiContext(input: unknown): PiContext {
  if (typeof input === "string") {
    return { messages: [{ role: "user", content: input, timestamp: Date.now() } as UserMessage] };
  }
  if (!Array.isArray(input)) return { messages: [] };
  return {
    messages: input
      .filter((item: any) => item.type === "message")
      .map((item: any) => {
        const content = responsePartsToPiContent(item.content);
        if (item.role === "assistant") {
          const text = content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
          return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(), api: "openai-responses" as any, provider: "openai" as any, model: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" as any } as AssistantMessage;
        }
        return { role: "user", content: content.length === 1 && content[0].type === "text" ? content[0].text : content, timestamp: Date.now() } as UserMessage;
      }) as Message[],
  };
}

function openAiToPiContext(messages: { role: string; content: any }[]): PiContext {
  return {
    systemPrompt: typeof messages.find((m) => m.role === "system")?.content === "string"
      ? messages.find((m) => m.role === "system")?.content
      : undefined,
    messages: messages.filter((m) => m.role !== "system").map((m) => {
      const content = chatPartsToPiContent(m.content);
      if (m.role === "assistant") {
        const text = content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
        return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(), api: "openai-responses" as any, provider: "openai" as any, model: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop" as any } as AssistantMessage;
      }
      return { role: "user", content: content.length === 1 && content[0].type === "text" ? content[0].text : content, timestamp: Date.now() } as UserMessage;
    }) as Message[],
  };
}

function makeResponse(id: string, model: string, status: string) {
  return { id, object: "response", created_at: Math.floor(Date.now() / 1000), status, model, output: [], error: null };
}

function responsePartsToPiContent(content: unknown): PiUserContentPart[] {
  if (!Array.isArray(content)) return [{ type: "text", text: String(content ?? "") }];
  const parts: PiUserContentPart[] = content.flatMap((part: any): PiUserContentPart[] => {
    if (part.type === "input_text" || part.type === "output_text") return [{ type: "text" as const, text: String(part.text ?? "") }];
    if (part.type === "input_image") return imageUrlToPiContent(part.image_url ?? part.imageUrl ?? part.url);
    return [];
  });
  return parts.length ? parts : [{ type: "text", text: "" }];
}

function chatPartsToPiContent(content: unknown): PiUserContentPart[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [{ type: "text", text: String(content ?? "") }];
  const parts: PiUserContentPart[] = content.flatMap((part: any): PiUserContentPart[] => {
    if (part.type === "text") return [{ type: "text" as const, text: String(part.text ?? "") }];
    if (part.type === "image_url") return imageUrlToPiContent(part.image_url?.url ?? part.image_url ?? part.url);
    return [];
  });
  return parts.length ? parts : [{ type: "text", text: "" }];
}

function imageUrlToPiContent(imageUrl: unknown): PiUserContentPart[] {
  if (typeof imageUrl !== "string") return [];
  const match = imageUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return [];
  return [{ type: "image", mimeType: match[1], data: match[2] }];
}
