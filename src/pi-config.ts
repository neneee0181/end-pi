import { readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { getOAuthApiKey, type OAuthCredentials } from "@earendil-works/pi-ai/oauth";

export interface PiOAuthEntry {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
}

export interface PiApiKeyEntry {
  type: "apiKey" | "api_key";
  key: string;
}

export type PiAuthEntry = PiOAuthEntry | PiApiKeyEntry;

export interface PiAuth {
  [provider: string]: PiAuthEntry;
}

export interface PiSettings {
  defaultProvider?: string;
  defaultModel?: string;
  [key: string]: unknown;
}

const PI_DIR = join(homedir(), ".pi", "agent");

export async function readPiAuth(): Promise<PiAuth> {
  const raw = await readFile(join(PI_DIR, "auth.json"), "utf-8");
  return JSON.parse(raw) as PiAuth;
}

export async function readPiSettings(): Promise<PiSettings> {
  try {
    const raw = await readFile(join(PI_DIR, "settings.json"), "utf-8");
    return JSON.parse(raw) as PiSettings;
  } catch {
    return {};
  }
}

export function isTokenExpired(entry: PiAuthEntry): boolean {
  if (entry.type !== "oauth") return false;
  return Date.now() >= entry.expires - 60_000;
}

export function getAccessToken(entry: PiAuthEntry): string {
  if (isApiKeyEntry(entry)) return entry.key;
  return entry.access;
}

export async function getAccessTokenForProvider(provider: string, auth: PiAuth, oauthProvider = provider): Promise<string> {
  const entry = auth[provider];
  if (!entry) throw new Error(`Provider "${provider}" not authenticated in Pi. Log in via Pi first.`);
  if (isApiKeyEntry(entry)) return entry.key;

  const result = await getOAuthApiKey(oauthProvider, { [oauthProvider]: entry as unknown as OAuthCredentials });
  if (!result) throw new Error(`Provider "${provider}" not authenticated in Pi. Log in via Pi first.`);

  auth[provider] = { type: "oauth", ...result.newCredentials };
  await writeFile(join(PI_DIR, "auth.json"), JSON.stringify(auth, null, 2), "utf-8");
  return result.apiKey;
}

function isApiKeyEntry(entry: PiAuthEntry): entry is PiApiKeyEntry {
  return entry.type === "apiKey" || entry.type === "api_key";
}
