import { Hono } from "hono";
import { stream as honoStream } from "hono/streaming";
import { getModel, getModels, stream as piStream } from "@earendil-works/pi-ai";
import type { Api, Context as PiContext, Message, Model, UserMessage, AssistantMessage } from "@earendil-works/pi-ai";
import { readPiAuth, readPiSettings, getAccessTokenForProvider } from "./pi-config.js";
import {
  ANTIGRAVITY_MODELS,
  createAntigravityModel,
  getAntigravityApiKey,
  isAntigravityProvider,
  streamAntigravityDirect,
} from "./antigravity.js";
import { createWriteStream, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

type PiUserContentPart = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type ProxyStreamFn = typeof piStream;
type ResponseOutputItem = Record<string, unknown>;
type RememberedToolCall = { id: string; name: string; arguments: Record<string, unknown>; thoughtSignature?: string };

// Log to file, not stdout (Pi TUI owns stdout)
const CODEX_DIR = join(homedir(), ".codex");
const REQUEST_LOG_DIR = join(CODEX_DIR, "end-pi-requests");
const logFile = createWriteStream(join(CODEX_DIR, "end-pi.log"), { flags: "a" });
logFile.on("error", () => {
  // Keep the proxy alive even if the log file is locked or unavailable.
});
const writeLog = (prefix: string, args: unknown[]) => {
  if (logFile.destroyed) return;
  logFile.write(`[${new Date().toISOString()}] ${prefix}${args.join(" ")}\n`);
};
const log = (...args: unknown[]) => writeLog("", args);
const logErr = (...args: unknown[]) => writeLog("ERR ", args);
const rememberedToolCalls = new Map<string, RememberedToolCall>();

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
  logRequestBody(body, "unresolved");

  const { piModel, accessToken, info, error, streamFn } = await resolvePiCurrentModel();
  if (error) return c.json({ error: { message: error } }, 503);

  log(`[ep] /v1/responses → ${info}`);

  const context = responsesInputToPiContext(body.input, body.instructions);
  context.tools = responseToolsToPiTools(body.tools);
  const respId = `resp_${Date.now()}`;

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
      let fullText = "";
      let textItemId = "";
      let textStarted = false;
      let outputIndex = 0;
      const outputItems: ResponseOutputItem[] = [];
      const ensureTextItem = async () => {
        if (textStarted) return;
        textStarted = true;
        textItemId = `msg_${Date.now()}`;
        await send("response.output_item.added", {
          type: "response.output_item.added",
          output_index: outputIndex,
          item: { id: textItemId, type: "message", role: "assistant", content: [], status: "in_progress" },
        });
        await send("response.content_part.added", {
          type: "response.content_part.added",
          item_id: textItemId, output_index: outputIndex, content_index: 0,
          part: { type: "output_text", text: "" },
        });
      };

      try {
        const eventStream = streamFn(piModel!, context, { apiKey: accessToken });
        for await (const event of eventStream) {
          if (event.type === "text_delta") {
            await ensureTextItem();
            fullText += event.delta;
            await send("response.output_text.delta", {
              type: "response.output_text.delta",
              item_id: textItemId, output_index: outputIndex, content_index: 0,
              delta: event.delta,
            });
          } else if (event.type === "toolcall_end") {
            if (textStarted) {
              await finishTextItem(send, textItemId, outputIndex, fullText);
              outputItems.push(messageOutputItem(textItemId, fullText));
              outputIndex += 1;
              textStarted = false;
              fullText = "";
            }
            const item = functionCallOutputItem(event.toolCall);
            await send("response.output_item.added", {
              type: "response.output_item.added",
              output_index: outputIndex,
              item: { ...item, status: "in_progress" },
            });
            await send("response.function_call_arguments.delta", {
              type: "response.function_call_arguments.delta",
              item_id: item.id,
              output_index: outputIndex,
              delta: item.arguments,
            });
            await send("response.function_call_arguments.done", {
              type: "response.function_call_arguments.done",
              item_id: item.id,
              output_index: outputIndex,
              arguments: item.arguments,
            });
            await send("response.output_item.done", {
              type: "response.output_item.done",
              output_index: outputIndex,
              item,
            });
            outputItems.push(item);
            outputIndex += 1;
          } else if (event.type === "error") {
            const message = streamErrorMessage(event);
            logErr(`[ep] stream error:`, message);
            if (!textStarted && !fullText && !outputItems.length) {
              fullText = `[end-pi provider error] ${message}`;
            }
            break;
          } else if (event.type === "done") {
            const doneItems = assistantContentToResponseOutput((event as any).message?.content ?? []);
            if (!textStarted && !fullText && !outputItems.length && doneItems.length) {
              outputItems.push(...doneItems);
              outputIndex += doneItems.length;
            }
            log(`[ep] stream done: ${(event as any).reason ?? "unknown"}, outputs=${outputItems.length + (fullText ? 1 : 0)}`);
          }
        }
      } catch (e: any) {
        logErr(`[ep] piStream error:`, e.message);
        fullText = `[end-pi error] ${e.message}`;
      }

      if (!textStarted && !fullText && !outputItems.length) {
        fullText = "[end-pi provider error] Provider stream ended without output.";
        logErr(`[ep] stream ended without output`);
      }
      if (textStarted || fullText) {
        await ensureTextItem();
        await finishTextItem(send, textItemId, outputIndex, fullText);
        outputItems.push(messageOutputItem(textItemId, fullText));
      }
      await send("response.completed", {
        type: "response.completed",
        response: {
          ...makeResponse(respId, info, "completed"),
          output: outputItems,
        },
      });
    });
  } else {
    const eventStream = streamFn(piModel!, context, { apiKey: accessToken });
    const result = await eventStream.result();
    const output = assistantContentToResponseOutput(result.content);
    return c.json({
      ...makeResponse(respId, info, "completed"),
      output,
      usage: { input_tokens: result.usage.input, output_tokens: result.usage.output, total_tokens: result.usage.totalTokens },
    });
  }
});

// POST /v1/chat/completions (fallback)
app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const { piModel, accessToken, info, error, streamFn } = await resolvePiCurrentModel();
  if (error) return c.json({ error: { message: error } }, 503);

  log(`[ep] /v1/chat/completions → ${info}`);
  const context = openAiToPiContext(body.messages ?? []);
  const id = `chatcmpl-${Date.now()}`;

  if (body.stream) {
    c.header("Content-Type", "text/event-stream");
    return honoStream(c, async (stream) => {
      const eventStream = streamFn(piModel!, context, { apiKey: accessToken });
      for await (const event of eventStream) {
        if (event.type === "text_delta") {
          await stream.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: info, choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }] })}\n\n`);
        }
      }
      await stream.write("data: [DONE]\n\n");
    });
  }
  const eventStream = streamFn(piModel!, context, { apiKey: accessToken });
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
    return { error: "Pi has no defaultProvider/defaultModel set. Use /model in Pi TUI.", piModel: null, accessToken: "", info: "", streamFn: piStream };
  }

  const authEntry = auth[provider];
  if (!authEntry) {
    return { error: `Provider "${provider}" not authenticated in Pi. Log in via Pi first.`, piModel: null, accessToken: "", info: "", streamFn: piStream };
  }

  const resolved = resolveProviderRegistry(provider, modelId);
  let piModel: Model<Api> | undefined;
  try {
    piModel = resolved.piModel ?? getModel(resolved.modelProvider as any, modelId as any);
  } catch { /* ignore */ }

  if (!piModel) {
    const available = getModels(resolved.modelProvider as any);
    if (!available.length) return { error: `No models for provider "${provider}"`, piModel: null, accessToken: "", info: "", streamFn: piStream };
    piModel = available[0];
    log(`[ep] "${modelId}" not in pi-ai registry for "${provider}", fallback to "${resolved.modelProvider}/${piModel.id}"`);
  }

  try {
    const accessToken = resolved.antigravity
      ? await getAntigravityApiKey(provider, auth)
      : await getAccessTokenForProvider(provider, auth, resolved.oauthProvider);
    return {
      piModel: { ...piModel, provider },
      accessToken,
      info: `${provider}/${piModel.id}`,
      error: null,
      streamFn: resolved.antigravity ? streamAntigravityDirect as ProxyStreamFn : piStream,
    };
  } catch (e: any) {
    return { error: e.message, piModel: null, accessToken: "", info: "", streamFn: piStream };
  }
}

function resolveProviderRegistry(provider: string, modelId: string): {
  modelProvider: string;
  oauthProvider: string;
  antigravity: boolean;
  piModel?: Model<Api>;
} {
  if (isAntigravityProvider(provider)) {
    return {
      modelProvider: "google-antigravity",
      oauthProvider: "google-antigravity",
      antigravity: true,
      piModel: createAntigravityModel(provider, ANTIGRAVITY_MODELS.includes(modelId as any) ? modelId : ANTIGRAVITY_MODELS[0]),
    };
  }

  const directModels = getModels(provider as any);
  if (directModels.length) return { modelProvider: provider, oauthProvider: provider, antigravity: false };

  const baseProvider = stripMultipassSuffix(provider);
  if (baseProvider !== provider && getModels(baseProvider as any).length) {
    return { modelProvider: baseProvider, oauthProvider: baseProvider, antigravity: false };
  }

  return { modelProvider: provider, oauthProvider: provider, antigravity: false };
}

function stripMultipassSuffix(provider: string): string {
  return provider.replace(/-\d+$/, "");
}

function responsesInputToPiContext(input: unknown, instructions?: unknown): PiContext {
  const systemPrompt = typeof instructions === "string" ? instructions : undefined;
  if (typeof input === "string") {
    return { systemPrompt, messages: [{ role: "user", content: input, timestamp: Date.now() } as UserMessage] };
  }
  if (!Array.isArray(input)) return { systemPrompt, messages: [] };
  const seenToolCalls = new Set<string>();
  return {
    systemPrompt,
    messages: input
      .flatMap((item: any): Message[] => {
        if (item.type === "function_call_output") {
          const callId = String(item.call_id ?? item.callId ?? item.id ?? "");
          const remembered = callId ? rememberedToolCalls.get(callId) : undefined;
          const messages: Message[] = [];
          if (remembered && !seenToolCalls.has(callId)) {
            messages.push(toolCallToAssistantMessage(remembered));
            seenToolCalls.add(callId);
          }
          messages.push({
            role: "toolResult",
            toolCallId: callId,
            toolName: String(item.name ?? item.tool_name ?? remembered?.name ?? "tool"),
            content: [{ type: "text", text: annotateToolOutput(String(item.output ?? "")) }],
            isError: Boolean(item.is_error ?? item.isError ?? false),
            timestamp: Date.now(),
          } as Message);
          return messages;
        }
        if (item.type === "function_call") {
          const callId = String(item.call_id ?? item.callId ?? item.id ?? "");
          const remembered = callId ? rememberedToolCalls.get(callId) : undefined;
          const parsedArgs = parseToolArguments(item.arguments);
          const toolCall = {
            id: callId,
            name: String(item.name ?? remembered?.name ?? ""),
            arguments: Object.keys(parsedArgs).length ? parsedArgs : remembered?.arguments ?? {},
            thoughtSignature: remembered?.thoughtSignature,
          };
          seenToolCalls.add(callId);
          return [toolCallToAssistantMessage(toolCall)];
        }
        if (item.type !== "message") return [];
        const content = responsePartsToPiContent(item.content);
        if (item.role === "assistant") {
          const text = content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
          return [{ role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(), api: "openai-responses" as any, provider: "openai" as any, model: "", usage: emptyUsage(), stopReason: "stop" as any } as AssistantMessage];
        }
        return [{ role: "user", content: content.length === 1 && content[0].type === "text" ? content[0].text : content, timestamp: Date.now() } as UserMessage];
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
        return { role: "assistant", content: [{ type: "text", text }], timestamp: Date.now(), api: "openai-responses" as any, provider: "openai" as any, model: "", usage: emptyUsage(), stopReason: "stop" as any } as AssistantMessage;
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

function responseToolsToPiTools(tools: unknown): PiContext["tools"] {
  if (!Array.isArray(tools)) return [];
  return tools.flatMap((tool: any) => {
    const fn = tool.function ?? tool;
    const name = fn.name ?? tool.name ?? (tool.type && tool.type !== "function" ? tool.type : undefined);
    if (!name) return [];
    return [{
      name: String(name),
      description: String(fn.description ?? tool.description ?? ""),
      parameters: fn.parameters ?? tool.parameters ?? tool.input_schema ?? { type: "object", properties: {} },
    }];
  });
}

function assistantContentToResponseOutput(content: AssistantMessage["content"]): ResponseOutputItem[] {
  const output: ResponseOutputItem[] = [];
  const text = content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  if (text) output.push(messageOutputItem(`msg_${Date.now()}`, text));
  for (const block of content as any[]) {
    if (block.type === "toolCall") output.push(functionCallOutputItem(block));
  }
  return output;
}

function streamErrorMessage(event: unknown): string {
  const error = (event as any)?.error;
  return String(error?.errorMessage ?? error?.message ?? error ?? "unknown provider error");
}

function messageOutputItem(id: string, text: string): ResponseOutputItem {
  return { id, type: "message", role: "assistant", content: [{ type: "output_text", text }], status: "completed" };
}

function functionCallOutputItem(toolCall: any): ResponseOutputItem {
  const args = JSON.stringify(toolCall.arguments ?? {});
  const callId = toolCall.id || `call_${Date.now()}`;
  rememberedToolCalls.set(callId, {
    id: callId,
    name: toolCall.name,
    arguments: toolCall.arguments ?? {},
    thoughtSignature: toolCall.thoughtSignature,
  });
  return {
    id: `fc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "function_call",
    call_id: callId,
    name: toolCall.name,
    arguments: args,
    status: "completed",
  };
}

function toolCallToAssistantMessage(toolCall: RememberedToolCall): AssistantMessage {
  return {
    role: "assistant",
    content: [{
      type: "toolCall",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
      ...(toolCall.thoughtSignature ? { thoughtSignature: toolCall.thoughtSignature } : {}),
    }],
    timestamp: Date.now(),
    api: "openai-responses" as any,
    provider: "openai" as any,
    model: "",
    usage: emptyUsage(),
    stopReason: "toolUse" as any,
  };
}

async function finishTextItem(
  send: (event: string, data: unknown) => Promise<unknown>,
  itemId: string,
  outputIndex: number,
  text: string,
): Promise<void> {
  await send("response.output_text.done", {
    type: "response.output_text.done",
    item_id: itemId,
    output_index: outputIndex,
    content_index: 0,
    text,
  });
  await send("response.content_part.done", {
    type: "response.content_part.done",
    item_id: itemId,
    output_index: outputIndex,
    content_index: 0,
    part: { type: "output_text", text },
  });
  await send("response.output_item.done", {
    type: "response.output_item.done",
    output_index: outputIndex,
    item: messageOutputItem(itemId, text),
  });
}

function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function annotateToolOutput(output: string): string {
  const notes: string[] = [];
  if (/Process running with session ID/i.test(output) && /Original token count:\s*0/i.test(output)) {
    notes.push("end-pi note: this background command has produced no output; do not keep polling it repeatedly. Try a quick local command or explain the blockage.");
  }
  if (/memoc.+not recognized|npm error code EACCES|npm exec @kevin0181\/memoc/i.test(output)) {
    notes.push("end-pi note: memoc is unavailable in this environment. Do not retry memoc; use local file search commands such as rg, Get-ChildItem, or project-specific files instead.");
  }
  return notes.length ? `${output}\n\n${notes.join("\n")}` : output;
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function logRequestBody(body: unknown, info: string): void {
  try {
    mkdirSync(REQUEST_LOG_DIR, { recursive: true });
    const file = join(REQUEST_LOG_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(file, JSON.stringify({ info, body: sanitizeForLog(body) }, null, 2), "utf-8");
  } catch (error: any) {
    logErr(`[ep] request log failed:`, error?.message ?? error);
  }
}

function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated-depth]";
  if (typeof value === "string") {
    if (value.startsWith("data:image/")) return `[image-data:${value.length}]`;
    if (value.length > 4000) return `${value.slice(0, 4000)}...[truncated:${value.length}]`;
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/api[_-]?key|authorization|token|secret/i.test(key)) out[key] = "[redacted]";
    else out[key] = sanitizeForLog(item, depth + 1);
  }
  return out;
}
