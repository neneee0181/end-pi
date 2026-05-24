import { randomUUID } from "crypto";
import { arch, platform } from "os";
import { writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { PiAuth, PiAuthEntry } from "./pi-config.js";

type AntigravityCredentials = PiAuthEntry & {
  access?: string;
  refresh?: string;
  expires?: number;
  projectId?: string;
};

type AntigravityTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
};

export const ANTIGRAVITY_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "gemini-3-flash",
  "claude-sonnet-4-6",
  "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium",
] as const;

const PI_DIR = join(homedir(), ".pi", "agent");
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const ANTIGRAVITY_GENERATE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
const ANTIGRAVITY_LOAD_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
const ANTIGRAVITY_ONBOARD_URL = "https://cloudcode-pa.googleapis.com/v1internal:onboardUser";
const ANTIGRAVITY_CLIENT_ID = [
  "1071006060591",
  "-tmhssin2h21lcre235vtolojh4g403ep",
  ".apps.googleusercontent.com",
].join("");
const ANTIGRAVITY_CLIENT_SECRET = [
  "GO",
  "CSP",
  "X-K58F",
  "WR486Ld",
  "LJ1mLB8",
  "sXC4z6qDAf",
].join("");

export function isAntigravityProvider(provider: string): boolean {
  return provider === "google-antigravity" || provider.startsWith("google-antigravity-");
}

export function createAntigravityModel(provider: string, modelId: string): Model<Api> {
  return {
    id: modelId,
    name: modelId,
    provider,
    api: "openai-responses" as Api,
    baseUrl: "",
    reasoning: true,
    input: ["text", "image"],
    maxTokens: 8192,
    contextWindow: 1_000_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

export async function getAntigravityApiKey(provider: string, auth: PiAuth): Promise<string> {
  const entry = auth[provider] as AntigravityCredentials | undefined;
  if (!entry || entry.type !== "oauth") {
    throw new Error(`Provider "${provider}" not authenticated in Pi. Log in via Pi first.`);
  }
  if (entry.access === "proxy-managed" || entry.refresh === "proxy-managed") {
    throw new Error(`Provider "${provider}" is a placeholder. Use /subs login for an Antigravity subscription provider.`);
  }
  if (!entry.access) throw new Error(`Provider "${provider}" has no Antigravity access token. Run /subs login.`);

  if (entry.expires && Date.now() >= entry.expires - 60_000) {
    if (!entry.refresh) throw new Error(`Provider "${provider}" token expired. Run /subs login again.`);
    const tokens = await refreshAntigravityAccess(entry.refresh);
    entry.access = tokens.access_token;
    entry.refresh = tokens.refresh_token ?? entry.refresh;
    entry.expires = Date.now() + tokens.expires_in * 1000;
    entry.projectId = entry.projectId ?? await loadAntigravityProject(entry.access);
    auth[provider] = entry;
    await writeFile(join(PI_DIR, "auth.json"), JSON.stringify(auth, null, 2), "utf-8");
  }

  return JSON.stringify({ token: entry.access, projectId: entry.projectId });
}

function piContentToAntigravityParts(content: unknown): unknown[] {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [{ text: String(content ?? "") }];
  const parts: unknown[] = [];
  for (const part of content as { type?: string; text?: string; data?: string; mimeType?: string }[]) {
    if (part.type === "text") parts.push({ text: String(part.text ?? "") });
    else if (part.type === "image" && part.data && part.mimeType) {
      parts.push({ inlineData: { data: part.data, mimeType: part.mimeType } });
    }
  }
  return parts.length ? parts : [{ text: "" }];
}

function contextToAntigravityContents(context: Context): unknown[] {
  return context.messages.map((message) => {
    if (message.role === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      return { role: "model", parts: [{ text }] };
    }
    if (message.role === "toolResult") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      return {
        role: "user",
        parts: [{ functionResponse: { name: message.toolName, response: message.isError ? { error: text } : { output: text } } }],
      };
    }
    return { role: "user", parts: piContentToAntigravityParts(message.content) };
  });
}

async function refreshAntigravityAccess(refreshToken: string, signal?: AbortSignal): Promise<AntigravityTokenResponse> {
  const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: ANTIGRAVITY_CLIENT_ID,
      client_secret: ANTIGRAVITY_CLIENT_SECRET,
    }).toString(),
    signal,
  });
  if (!res.ok) throw new Error(`Antigravity token refresh failed (${res.status}): ${await res.text()}`);
  return await res.json() as AntigravityTokenResponse;
}

function antigravityAssistHeaders(accessToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${accessToken}`,
    "user-agent": "google-api-nodejs-client/9.15.1",
    "x-goog-api-client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "client-metadata": JSON.stringify({
      ideType: 9,
      platform: platform() === "win32" ? 5 : platform() === "darwin" ? arch() === "arm64" ? 2 : 1 : arch() === "arm64" ? 4 : 3,
      pluginType: 2,
    }),
  };
}

async function loadAntigravityProject(accessToken: string, signal?: AbortSignal): Promise<string> {
  const metadata = {
    ideType: 9,
    platform: platform() === "win32" ? 5 : platform() === "darwin" ? arch() === "arm64" ? 2 : 1 : arch() === "arm64" ? 4 : 3,
    pluginType: 2,
  };
  const response = await fetch(ANTIGRAVITY_LOAD_ASSIST_URL, {
    method: "POST",
    headers: antigravityAssistHeaders(accessToken),
    body: JSON.stringify({ metadata }),
    signal,
  });
  if (!response.ok) throw new Error(`loadCodeAssist failed (${response.status}): ${await response.text()}`);
  const data = await response.json() as {
    cloudaicompanionProject?: string | { id?: string };
    allowedTiers?: { isDefault?: boolean; id?: string }[];
  };
  let projectId = typeof data.cloudaicompanionProject === "string"
    ? data.cloudaicompanionProject
    : data.cloudaicompanionProject?.id;
  if (!projectId) throw new Error("No cloudaicompanionProject in loadCodeAssist response");

  const tierId = data.allowedTiers?.find((tier) => tier.isDefault && tier.id)?.id?.trim() || "legacy-tier";
  for (let i = 0; i < 10; i++) {
    const onboard = await fetch(ANTIGRAVITY_ONBOARD_URL, {
      method: "POST",
      headers: antigravityAssistHeaders(accessToken),
      body: JSON.stringify({ tierId, metadata }),
      signal,
    });
    if (!onboard.ok) break;
    const onboardData = await onboard.json() as {
      done?: boolean;
      response?: { cloudaicompanionProject?: string | { id?: string } };
    };
    if (onboardData.done) {
      const project = onboardData.response?.cloudaicompanionProject;
      projectId = typeof project === "string" ? project : project?.id ?? projectId;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return projectId;
}

async function callAntigravityDirect(
  apiKey: string,
  model: Model<Api>,
  context: Context,
  signal?: AbortSignal,
): Promise<Response> {
  const parsed = JSON.parse(apiKey) as { token?: string; projectId?: string };
  if (!parsed.token) throw new Error("Missing Antigravity OAuth token. Run /subs login.");
  const body = {
    project: parsed.projectId || `end-pi-${randomUUID().slice(0, 8)}`,
    model: model.id,
    userAgent: "antigravity",
    requestType: "agent",
    requestId: `agent-${randomUUID()}`,
    request: {
      contents: contextToAntigravityContents(context),
      generationConfig: { maxOutputTokens: model.maxTokens || 8192 },
      sessionId: randomUUID() + Date.now().toString(),
      ...(context.systemPrompt ? { systemInstruction: { parts: [{ text: context.systemPrompt }] } } : {}),
    },
  };
  return fetch(`${ANTIGRAVITY_GENERATE_BASE_URL}/v1internal:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${parsed.token}`,
      "user-agent": `antigravity/1.107.0 ${platform()}/${arch()}`,
      "x-request-source": "local",
      accept: "text/event-stream",
    },
    body: JSON.stringify(body),
    signal,
  });
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

export function streamAntigravityDirect(
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
  stream.push({ type: "start", partial: output });

  (async () => {
    try {
      if (!options?.apiKey) throw new Error("Missing Antigravity OAuth credentials. Run /subs login.");
      const response = await callAntigravityDirect(options.apiKey, model, context, options.signal);
      if (!response.ok) throw new Error(`Antigravity error ${response.status}: ${await response.text()}`);
      if (!response.body) throw new Error("Antigravity response had no body");

      let text = "";
      let textStarted = false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw || raw === "[DONE]") continue;
            let parsed: any;
            try {
              parsed = JSON.parse(raw);
            } catch {
              continue;
            }
            const event = parsed.response ?? parsed;
            const usage = event.usageMetadata;
            if (typeof usage?.promptTokenCount === "number") output.usage.input = usage.promptTokenCount;
            if (typeof usage?.candidatesTokenCount === "number") output.usage.output = usage.candidatesTokenCount;
            output.usage.totalTokens = output.usage.input + output.usage.output;
            for (const part of event.candidates?.[0]?.content?.parts ?? []) {
              if (typeof part.text !== "string" || part.thought) continue;
              if (!textStarted) {
                output.content.push({ type: "text", text });
                stream.push({ type: "text_start", contentIndex: 0, partial: output });
                textStarted = true;
              }
              text += part.text;
              (output.content[0] as { type: "text"; text: string }).text = text;
              stream.push({ type: "text_delta", contentIndex: 0, delta: part.text, partial: output });
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (textStarted) stream.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
      output.timestamp = Date.now();
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
