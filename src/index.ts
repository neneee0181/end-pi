#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { spawn, spawnSync } from "child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { app } from "./server.js";
import { readPiAuth, readPiSettings, isTokenExpired } from "./pi-config.js";
import { applyProxy, restoreProxy, isProxyActive, migrateToProxy } from "./codex-patch.js";
import { findCodexLaunchTarget, killCodexDesktop, launchCodexDesktop, setUserEnv } from "./platform.js";

const PORT = 3141;
const args = process.argv.slice(2);
const CODEX_DIR = join(homedir(), ".codex");
const PID_FILE = join(CODEX_DIR, "end-pi-proxy.pid");
const LOG_FILE = join(CODEX_DIR, "end-pi.log");
const REQUEST_LOG_DIR = join(CODEX_DIR, "end-pi-requests");
const ENTRY_FILE = fileURLToPath(import.meta.url);
const PACKAGE_JSON_FILE = join(dirname(ENTRY_FILE), "..", "package.json");
const MULTIPASS_PACKAGE = "end-pi-multi-pass";
const MULTIPASS_GIT_SPEC = "git:github.com/neneee0181/end-pi-multi-pass";
const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const PI_EXTENSIONS_DIR = join(homedir(), ".pi", "agent", "extensions");

async function main() {
  if (args.includes("--proxy-daemon")) {
    await runProxyDaemon();
    return;
  }

  if (args.includes("--switch-proxy")) {
    await switchToProxy();
    return;
  }

  if (args.includes("--switch-restore")) {
    await switchToVanilla();
    return;
  }

  if (!args.includes("--no-update")) {
    const updated = await maybeSelfUpdate();
    if (updated) return;
  }

  if (args.includes("setup") || args.includes("--setup") || args.includes("--install-multipass")) {
    await installMultipass();
    return;
  }

  if (args.includes("logs") || args.includes("--logs")) {
    printLogs();
    return;
  }

  if (args.includes("--restore") || args.includes("--resotre") || args.includes("-r")) {
    console.log("\n[ end-pi ] Restoring Codex to vanilla...\n");
    if (!isProxyActive()) {
      console.log("  Already restored. Opening Pi TUI.\n");
      launchPiTui();
      return;
    }
    startTransition("--switch-restore");
    console.log("  Switching in background. Codex will restart.");
    return;
  }

  if (args.includes("--status") || args.includes("-s")) {
    const active = isProxyActive();
    const auth = await readPiAuth().catch(() => ({}));
    const settings = await readPiSettings();
    console.log(`\n[ end-pi ] Status`);
    console.log(`  Proxy:    ${active ? "✓ active" : "✗ inactive"}`);
    console.log(`  Model:    ${settings.defaultProvider ?? "?"}/${settings.defaultModel ?? "?"}`);
    console.log(`  Providers:`);
    for (const [provider, entry] of Object.entries(auth)) {
      const expired = isTokenExpired(entry);
      console.log(`    ${expired ? "✗" : "✓"} ${provider}${expired ? " (expired)" : ""}`);
    }
    console.log(`  Daemon:   ${(await isProxyDaemonRunning()) ? "✓ running" : "✗ stopped"}`);
    console.log(`  Multi-pass: ${isMultipassInstalled() ? "✓ installed" : "✗ not installed"}`);
    console.log(`  Log:      ~/.codex/end-pi.log`);
    return;
  }

  // Validate auth
  let auth: Awaited<ReturnType<typeof readPiAuth>>;
  try {
    auth = await readPiAuth();
  } catch {
    console.error("[ end-pi ] Pi auth not found. Open Pi and log in first.");
    process.exit(1);
  }

  const activeProviders = Object.entries(auth).filter(([, e]) => !isTokenExpired(e));
  if (activeProviders.length === 0) {
    console.error("[ end-pi ] All Pi tokens expired. Run 'pi' first and re-authenticate.");
    process.exit(1);
  }

  const alreadyActive = isProxyActive();
  if (!alreadyActive) {
    startTransition("--switch-proxy");
    console.log(`[ end-pi ] switching to proxy in background. Codex will restart.`);
    return;
  }

  await ensureProxyDaemon();
  migrateToProxy();
  setUserEnv("EP_API_KEY", "end-pi-local");

  // Print startup info BEFORE Pi takes over stdout
  console.log(`[ end-pi ] proxy:${PORT} | already active | log: ~/.codex/end-pi.log`);
  console.log(`[ end-pi ] multipass:${isMultipassInstalled() ? "installed" : "not installed (run 'ep setup')"}`);

  launchPiTui();
}

function printLogs(): void {
  const linesArg = args.find((arg) => /^--lines=\d+$/.test(arg));
  const lines = linesArg ? Number(linesArg.split("=")[1]) : 120;
  console.log(`\n[ end-pi ] Logs`);
  console.log(`  Main:     ${LOG_FILE}`);
  console.log(`  Requests: ${REQUEST_LOG_DIR}\n`);

  try {
    const log = readFileSync(LOG_FILE, "utf-8").split(/\r?\n/).filter(Boolean);
    for (const line of log.slice(-lines)) console.log(line);
  } catch {
    console.log("  No main log found yet.");
  }

  try {
    const requests = readdirSync(REQUEST_LOG_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .slice(-5);
    if (requests.length) {
      console.log(`\n[ end-pi ] Recent request logs`);
      for (const name of requests) console.log(`  ${join(REQUEST_LOG_DIR, name)}`);
    }
  } catch {
    // No request logs yet.
  }
}

async function maybeSelfUpdate(): Promise<boolean> {
  if (process.env.EP_SKIP_UPDATE === "1") return false;

  const current = getCurrentPackageVersion();
  if (!current) return false;

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const latest = spawnSync(npm, ["view", "end-pi", "version"], {
    encoding: "utf-8",
    windowsHide: true,
    timeout: 10_000,
  });
  if (latest.status !== 0) return false;

  const latestVersion = latest.stdout.trim();
  if (!latestVersion || compareVersions(latestVersion, current) <= 0) return false;

  console.log(`[ end-pi ] update available ${current} → ${latestVersion}. Installing first...`);
  const install = spawnSync(npm, ["install", "-g", `end-pi@${latestVersion}`], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (install.status !== 0) {
    console.warn(`[ end-pi ] update failed; continuing with ${current}.`);
    return false;
  }

  console.log(`[ end-pi ] updated to ${latestVersion}. Restarting command...\n`);
  const restart = spawnSync(process.execPath, selfArgs(...args.filter((arg) => arg !== "--no-update")), {
    stdio: "inherit",
    env: { ...process.env, EP_SKIP_UPDATE: "1" },
    windowsHide: true,
  });
  process.exit(restart.status ?? 0);
}

function getCurrentPackageVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_FILE, "utf-8")) as { version?: string };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function switchToProxy(): Promise<void> {
  daemonLog("switch proxy: start");
  await ensureProxyDaemon();
  const launchTarget = findCodexLaunchTarget();
  killCodexDesktop();
  await new Promise((r) => setTimeout(r, 1200));
  await applyProxy(PORT);
  migrateToProxy();
  setUserEnv("EP_API_KEY", "end-pi-local");
  daemonLog(`switch proxy: launch=${launchCodexDesktop(launchTarget)}`);
  daemonLog("switch proxy: complete");
}

async function switchToVanilla(): Promise<void> {
  daemonLog("switch restore: start");
  const launchTarget = findCodexLaunchTarget();
  killCodexDesktop();
  await new Promise((r) => setTimeout(r, 1200));
  await restoreProxy();
  daemonLog(`switch restore: launch=${launchCodexDesktop(launchTarget)}`);
  daemonLog("switch restore: complete");
}

function startTransition(mode: "--switch-proxy" | "--switch-restore"): void {
  const child = spawn(process.execPath, selfArgs(mode), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function launchPiTui(): void {
  const pi = spawn("pi", [], { stdio: "inherit", shell: true });

  pi.on("close", async (code) => {
    process.exit(code ?? 0);
  });

  process.on("SIGINT", () => pi.kill("SIGINT"));
}

async function installMultipass(): Promise<void> {
  console.log(`\n[ end-pi ] Multi-pass companion`);
  if (isMultipassInstalled()) {
    console.log(`  ✓ ${MULTIPASS_PACKAGE} is already installed.`);
    console.log(`  Open Pi with 'ep' and use /subs, /pool, or /mp-preset.\n`);
    return;
  }

  console.log(`  Installing ${MULTIPASS_PACKAGE} with Pi...\n`);
  let code = await runInteractive("pi", ["install", `npm:${MULTIPASS_PACKAGE}`]);
  if (code !== 0) {
    console.log(`\n  npm install failed; trying ${MULTIPASS_GIT_SPEC}...\n`);
    code = await runInteractive("pi", ["install", MULTIPASS_GIT_SPEC]);
  }
  if (code !== 0) {
    throw new Error(`pi install failed with exit code ${code}`);
  }

  if (isMultipassInstalled()) {
    console.log(`\n  ✓ ${MULTIPASS_PACKAGE} installed.`);
    console.log(`  Open Pi with 'ep' and use /subs, /pool, or /mp-preset.\n`);
    return;
  }

  console.log(`\n  Install command finished, but the extension was not detected in ~/.pi/agent/extensions.`);
  console.log(`  Open Pi once, then run 'ep --status' to check again.\n`);
}

function isMultipassInstalled(): boolean {
  const extensionDirs = [
    PI_EXTENSIONS_DIR,
    join(PI_AGENT_DIR, "npm", "node_modules", MULTIPASS_PACKAGE, "extensions"),
    join(PI_AGENT_DIR, "git", "github.com", "neneee0181", MULTIPASS_PACKAGE, "extensions"),
  ];

  return extensionDirs.some(hasMultipassExtension);
}

function hasMultipassExtension(dir: string): boolean {
  try {
    const files = readdirSync(dir, { withFileTypes: true });
    return files.some((file) => {
      if (!file.isFile() || !file.name.endsWith(".ts")) return false;
      const path = join(dir, file.name);
      const source = readFileSync(path, "utf-8");
      return source.includes("/mp-preset") && source.includes("/subs") && source.includes("/pool");
    });
  } catch {
    return false;
  }
}

function runInteractive(command: string, commandArgs: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = process.platform === "win32"
      ? spawn([command, ...commandArgs].join(" "), { stdio: "inherit", shell: true })
      : spawn(command, commandArgs, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", resolve);
  });
}

async function runProxyDaemon(): Promise<void> {
  process.on("uncaughtException", (err) => {
    daemonLog(`daemon crash: ${err.stack ?? err.message}`);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    daemonLog(`daemon rejection: ${String(err)}`);
    process.exit(1);
  });

  writeFileSync(PID_FILE, String(process.pid), "utf-8");
  daemonLog(`daemon starting pid=${process.pid}`);

  const server = serve({ fetch: app.fetch, port: PORT });
  daemonLog(`daemon listening http://localhost:${PORT}`);
  const cleanup = () => {
    server.close();
    if (existsSync(PID_FILE) && readFileSync(PID_FILE, "utf-8").trim() === String(process.pid)) {
      unlinkSync(PID_FILE);
    }
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

async function ensureProxyDaemon(): Promise<void> {
  if (await isProxyDaemonRunning()) return;

  const child = spawn(process.execPath, selfArgs("--proxy-daemon"), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isProxyDaemonRunning()) return;
  }

  throw new Error("Proxy daemon did not start. Run 'ep --status' or check ~/.codex/end-pi.log.");
}

function selfArgs(...nextArgs: string[]): string[] {
  if (ENTRY_FILE.endsWith(".ts")) {
    const tsxCli = join(dirname(ENTRY_FILE), "..", "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(tsxCli)) return [tsxCli, ENTRY_FILE, ...nextArgs];
  }
  return [ENTRY_FILE, ...nextArgs];
}

async function isProxyDaemonRunning(): Promise<boolean> {
  for (const host of ["localhost", "[::1]", "127.0.0.1"]) {
    try {
      const res = await fetch(`http://${host}:${PORT}/health`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) continue;
      const body = await res.json().catch(() => null) as { service?: string } | null;
      if (body?.service === "end-pi") return true;
    } catch { /* try next host */ }
  }
  return false;
}

function daemonLog(message: string): void {
  try {
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${message}\n`, "utf-8");
  } catch { /* logging must not break startup */ }
}

main().catch((err) => {
  console.error("[ end-pi ] Error:", err.message);
  process.exit(1);
});
