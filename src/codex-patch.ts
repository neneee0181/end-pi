import { readFile, writeFile, copyFile } from "fs/promises";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { getProcessCommandLine, stopProcess, unsetUserEnv } from "./platform.js";

const CODEX_DIR = join(homedir(), ".codex");
const CODEX_CONFIG = join(CODEX_DIR, "config.toml");
const CODEX_BACKUP = join(CODEX_DIR, "config.toml.end-pi-backup");
const SESSIONS_DIR = join(CODEX_DIR, "sessions");
const PROVIDER_MAP_FILE = join(CODEX_DIR, "end-pi-provider-map.json");
const PROXY_PID_FILE = join(CODEX_DIR, "end-pi-proxy.pid");
const DB_BACKUP_SUFFIX = "end-pi-backup";

const PROVIDER_ID = "end-pi";
const OPENAI_PROVIDER_ID = "openai";
const MODEL_ID = "end-pi";
const PROVIDER_BLOCK = (port: number) => `
[model_providers.${PROVIDER_ID}]
name = "Pi Proxy"
base_url = "http://localhost:${port}/v1"
wire_api = "responses"
env_key = "EP_API_KEY"
`;

const MODEL_PROVIDER_LINE = `model_provider = "${PROVIDER_ID}"`;
const MODEL_LINE = `model = "${MODEL_ID}"`;

type ThreadProviderMap = Record<string, { modelProvider: string; model: string | null }>;

export async function applyProxy(port: number): Promise<void> {
  const config = await readFile(CODEX_CONFIG, "utf-8");

  // Backup if not already backed up
  if (!existsSync(CODEX_BACKUP)) {
    await copyFile(CODEX_CONFIG, CODEX_BACKUP);
    console.log(`  ✓ Backed up config → config.toml.end-pi-backup`);
  }

  // Insert stable proxy model/provider after existing top-level keys.
  const lines = config.split("\n");
  const insertAt = lines.findIndex((l) => l.startsWith("["));
  const before = (insertAt === -1 ? lines : lines.slice(0, insertAt))
    .filter((l) => !l.trim().startsWith("model_provider =") && !l.trim().startsWith("model ="));
  const after = insertAt === -1 ? [] : lines.slice(insertAt);
  const hasProviderBlock = config.includes(`[model_providers.${PROVIDER_ID}]`);

  const patched =
    [...before, MODEL_LINE, MODEL_PROVIDER_LINE, "", ...after].join("\n") +
    (hasProviderBlock ? "" : PROVIDER_BLOCK(port));

  await writeFile(CODEX_CONFIG, patched, "utf-8");

  // Set dummy API key (proxy doesn't validate, but Codex requires env_key to exist)
  process.env["EP_API_KEY"] = "end-pi-local";

  console.log(`  ✓ config.toml patched — provider "end-pi" active`);
}

export async function restoreProxy(): Promise<void> {
  if (!existsSync(CODEX_BACKUP)) {
    console.log("  No backup found. Nothing to restore.");
    migrateToVanilla();
  } else {
    await copyFile(CODEX_BACKUP, CODEX_CONFIG);
    console.log("  ✓ config.toml restored from backup");

    migrateToVanilla();
  }

  unsetUserEnv("EP_API_KEY");
  unsetUserEnv("OPENAI_BASE_URL");
  console.log("  ✓ EP_API_KEY, OPENAI_BASE_URL removed");

  stopProxyDaemon();

  console.log("\n  ✓ Restored.");
}

export function migrateToProxy(): void {
  const codexDb = getCodexDbPath();
  let dbChanged = 0;
  let db: Database.Database | undefined;
  try {
    if (codexDb) {
      backupCodexDb(codexDb);
      db = new Database(codexDb);
      const res = db.prepare(
        `UPDATE threads SET model_provider = ?, model = ? WHERE model_provider IS NULL OR model_provider IN (?, ?)`
      ).run(PROVIDER_ID, MODEL_ID, OPENAI_PROVIDER_ID, PROVIDER_ID);
      dbChanged = res.changes;
      db.pragma("wal_checkpoint(TRUNCATE)");
    }

    const fileChanged = migrateRolloutFiles(PROVIDER_ID, [OPENAI_PROVIDER_ID, PROVIDER_ID]);
    console.log(`  ✓ threads → proxy: ${dbChanged} DB row(s), ${fileChanged} session file(s)`);
  } catch (e: any) {
    console.log(`  ! Thread migration failed: ${e.message}`);
  } finally {
    db?.close();
  }
}

export function migrateToVanilla(): void {
  const codexDb = getCodexDbPath();
  let dbChanged = 0;
  let db: Database.Database | undefined;
  try {
    if (codexDb) {
      backupCodexDb(codexDb);
      db = new Database(codexDb);
      const fallbackModel = getConfiguredModel() ?? "gpt-5.5";
      const res = db.prepare(`UPDATE threads SET model_provider = ?, model = ? WHERE model_provider = ? OR model = ?`)
        .run(OPENAI_PROVIDER_ID, fallbackModel, PROVIDER_ID, MODEL_ID);
      dbChanged = res.changes;
      db.pragma("wal_checkpoint(TRUNCATE)");
    }

    const fileChanged = migrateRolloutFiles(OPENAI_PROVIDER_ID, [PROVIDER_ID]);
    if (existsSync(PROVIDER_MAP_FILE)) unlinkSync(PROVIDER_MAP_FILE);
    console.log(`  ✓ threads → vanilla: ${dbChanged} DB row(s), ${fileChanged} session file(s)`);
  } catch (e: any) {
    console.log(`  ! Thread migration failed: ${e.message}`);
  } finally {
    db?.close();
  }
}

export function isProxyActive(): boolean {
  try {
    const config = readFileSync(CODEX_CONFIG, "utf-8");
    return config.includes(`[model_providers.${PROVIDER_ID}]`);
  } catch {
    return false;
  }
}

function readProviderMap(): ThreadProviderMap {
  if (!existsSync(PROVIDER_MAP_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(PROVIDER_MAP_FILE, "utf-8")) as Record<string, string | { modelProvider: string; model?: string | null }>;
    const map: ThreadProviderMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        map[id] = { modelProvider: value, model: null };
      } else {
        map[id] = { modelProvider: value.modelProvider, model: value.model ?? null };
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writeProviderMap(map: ThreadProviderMap): void {
  writeFileSync(PROVIDER_MAP_FILE, JSON.stringify(map, null, 2), "utf-8");
}

function backupCodexDb(codexDb: string): void {
  const backupPath = `${codexDb}.${DB_BACKUP_SUFFIX}-${Date.now()}`;
  copyFileSync(codexDb, backupPath);
}

function stopProxyDaemon(): void {
  if (!existsSync(PROXY_PID_FILE)) return;
  const pid = Number(readFileSync(PROXY_PID_FILE, "utf-8").trim());
  if (Number.isInteger(pid) && pid > 0 && isProxyDaemonPid(pid)) {
    try {
      stopProcess(pid);
      console.log("  ✓ proxy daemon stopped");
    } catch { /* already stopped */ }
  }
  try {
    unlinkSync(PROXY_PID_FILE);
  } catch { /* already removed */ }
}

function isProxyDaemonPid(pid: number): boolean {
  return getProcessCommandLine(pid).includes("--proxy-daemon");
}

function getCodexDbPath(): string | null {
  if (!existsSync(CODEX_DIR)) return null;
  const candidates = readdirSync(CODEX_DIR)
    .filter((name) => /^state_\d+\.sqlite$/.test(name))
    .map((name) => join(CODEX_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function getConfiguredModel(): string | null {
  try {
    const topLevel = readFileSync(CODEX_CONFIG, "utf-8").split(/\n\[/, 1)[0];
    return topLevel.match(/^model\s*=\s*"([^"]+)"/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

function migrateRolloutFiles(targetProvider: string, sourceProviders: string[]): number {
  let changed = 0;
  for (const filePath of findRolloutFiles(SESSIONS_DIR)) {
    if (patchRolloutFile(filePath, targetProvider, sourceProviders)) changed++;
  }
  return changed;
}

function patchRolloutFile(filePath: string, targetProvider: string, sourceProviders: string[]): boolean {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    if (!lines[0]) return false;
    const firstLine = JSON.parse(lines[0]);
    if (firstLine.type !== "session_meta") return false;
    const payload = firstLine.payload;
    if (!payload || typeof payload !== "object") return false;
    const currentProvider = payload.model_provider;
    if (currentProvider === targetProvider || !sourceProviders.includes(currentProvider)) return false;
    payload.model_provider = targetProvider;
    lines[0] = JSON.stringify(firstLine);
    writeFileSync(filePath, lines.join("\n"), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function findRolloutFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findRolloutFiles(full));
    } else if (entry.endsWith(".jsonl")) {
      results.push(full);
    }
  }
  return results;
}
