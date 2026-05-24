import type { PiAuth } from "./pi-config.js";

export interface ProxyModel {
  id: string;           // model ID exposed to Codex (no provider prefix)
  provider: string;     // Pi provider to route to
  piModelId: string;    // exact model ID in pi-ai
}

// Models available per provider (pi-ai verified IDs)
const PROVIDER_MODELS: Record<string, string[]> = {
  "openai-codex": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2"],
  "github-copilot": ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5-mini", "gpt-4o", "gpt-4.1", "claude-sonnet-4.6", "claude-opus-4.7", "claude-haiku-4.5", "gemini-2.5-pro", "gemini-3.5-flash", "grok-code-fast-1"],
  "anthropic": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  "google": ["gemini-2.5-pro", "gemini-2.5-flash"],
  "groq": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  "openai": ["gpt-4o", "gpt-4.1", "o3"],
};

// Provider priority: prefer openai-codex for shared models (Plus account), then copilot
const PROVIDER_PRIORITY = ["openai-codex", "github-copilot", "anthropic", "google", "groq", "openai"];

export function buildModelList(auth: PiAuth): ProxyModel[] {
  const seen = new Set<string>();
  const models: ProxyModel[] = [];

  // Build in priority order so best provider wins for shared models
  for (const provider of PROVIDER_PRIORITY) {
    if (!auth[provider]) continue;

    const piModels = PROVIDER_MODELS[provider];
    if (!piModels) continue;

    for (const modelId of piModels) {
      if (seen.has(modelId)) continue; // already covered by higher-priority provider
      seen.add(modelId);
      models.push({ id: modelId, provider, piModelId: modelId });
    }
  }

  return models;
}

// Given a plain model ID (e.g. "gpt-5.5"), find which provider to use
export function resolveProviderForModel(modelId: string, auth: PiAuth): { provider: string; piModelId: string } | null {
  for (const provider of PROVIDER_PRIORITY) {
    const entry = auth[provider];
    if (!entry) continue;
    // Skip expired tokens
    if (entry.type === "oauth" && Date.now() >= entry.expires - 60_000) continue;
    const piModels = PROVIDER_MODELS[provider];
    if (piModels?.includes(modelId)) {
      return { provider, piModelId: modelId };
    }
  }
  return null;
}
