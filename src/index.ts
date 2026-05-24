#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { spawn, spawnSync } from "child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createServer } from "net";
import { app } from "./server.js";
import { readPiAuth, readPiSettings, isTokenExpired } from "./pi-config.js";
import { applyProxy, restoreProxy, isProxyActive, migrateToProxy } from "./codex-patch.js";
import { findCodexLaunchTarget, killCodexDesktop, launchCodexDesktop, setUserEnv } from "./platform.js";

const DEFAULT_PORT = 3141;
const PORT_FILE = join(homedir(), ".codex", "end-pi-port");
const args = process.argv.slice(2);
const CODEX_DIR = join(homedir(), ".codex");
const PID_FILE = join(CODEX_DIR, "end-pi-proxy.pid");
const LOG_FILE = join(CODEX_DIR, "end-pi.log");
const REQUEST_LOG_DIR = join(CODEX_DIR, "end-pi-requests");
const ENTRY_FILE = fileURLToPath(import.meta.url);
const PACKAGE_JSON_FILE = join(dirname(ENTRY_FILE), "..", "package.json");
const MULTIPASS_PACKAGE = "end-pi-multi-pass";
const MULTIPASS_GIT_SPEC = process.env.END_PI_MULTIPASS_GIT;
const PI_AGENT_DIR = join(homedir(), ".pi", "agent");
const PI_EXTENSIONS_DIR = join(homedir(), ".pi", "agent", "extensions");

type DoctorCheck = { name: string; ok: boolean; detail: string; hint?: string };
type DoctorReport = {
  service: "end-pi";
  version: string | null;
  platform: NodeJS.Platform;
  arch: string;
  node: string;
  endpoint: string;
  proxyActive: boolean;
  daemonRunning: boolean;
  paths: { codexDir: string; logFile: string; requestLogDir: string };
  recentRequestLogs: string[];
  checks: DoctorCheck[];
};

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

  if (args.includes("--version") || args.includes("-v")) {
    console.log(getCurrentPackageVersion() ?? "unknown");
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

  if (args.includes("doctor") || args.includes("--doctor")) {
    await runDoctor(args.includes("--fix"));
    return;
  }

  if (args.includes("smoke") || args.includes("--smoke")) {
    printSmokeChecklist();
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
    const port = readSavedProxyPort();
    const auth = await readPiAuth().catch(() => ({}));
    const settings = await readPiSettings();
    console.log(`\n[ end-pi ] Status`);
    console.log(`  Proxy:    ${active ? "✓ active" : "✗ inactive"}`);
    console.log(`  Endpoint: http://localhost:${port}/v1`);
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
  const port = readSavedProxyPort();
  migrateToProxy();
  await applyProxy(port);
  setUserEnv("EP_API_KEY", "end-pi-local");

  // Print startup info BEFORE Pi takes over stdout
  console.log(`[ end-pi ] proxy:${port} | already active | log: ~/.codex/end-pi.log`);
  console.log(`[ end-pi ] multipass:${isMultipassInstalled() ? "installed" : "not installed (run 'ep setup')"}`);

  launchPiTui();
}

function printLogs(): void {
  const linesArg = args.find((arg) => /^--lines=\d+$/.test(arg));
  const lines = linesArg ? Number(linesArg.split("=")[1]) : 120;
  if (args.includes("--clean")) {
    cleanRequestLogs(parseKeepArg(100));
    return;
  }

  console.log(`\n[ end-pi ] Logs`);
  console.log(`  Main:     ${LOG_FILE}`);
  console.log(`  Requests: ${REQUEST_LOG_DIR}\n`);

  if (args.includes("--requests")) {
    printRequestLogs();
    return;
  }

  if (args.includes("--last-request")) {
    printLastRequestSummary();
    return;
  }

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

function printRequestLogs(): void {
  const requests = getRecentRequestLogs(20);
  if (!requests.length) {
    console.log("  No request logs found.");
    return;
  }
  for (const name of requests) console.log(`  ${join(REQUEST_LOG_DIR, name)}`);
}

function printLastRequestSummary(): void {
  const [latest] = getRecentRequestLogs(1).reverse();
  if (!latest) {
    console.log("  No request logs found.");
    return;
  }
  const file = join(REQUEST_LOG_DIR, latest);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8"));
    const body = parsed.body ?? {};
    const calls = Array.isArray(body.input)
      ? body.input.filter((item: any) => item?.type === "function_call").slice(-8)
      : [];
    console.log(`  File:  ${file}`);
    console.log(`  Model: ${body.model ?? "unknown"}`);
    console.log(`  Stream: ${String(body.stream ?? false)}`);
    console.log(`  Tools: ${Array.isArray(body.tools) ? body.tools.length : 0}`);
    console.log(`  Calls: ${calls.length}`);
    for (const call of calls) {
      const args = summarizeToolArgs(call.arguments);
      console.log(`    - ${call.name ?? "tool"} ${args}`);
    }
  } catch (error: any) {
    console.log(`  Failed to read ${file}: ${error?.message ?? error}`);
  }
}

function getRecentRequestLogs(limit: number): string[] {
  try {
    return readdirSync(REQUEST_LOG_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .slice(-limit);
  } catch {
    return [];
  }
}

function cleanRequestLogs(keep: number): void {
  try {
    const requests = readdirSync(REQUEST_LOG_DIR)
      .filter((name) => name.endsWith(".json"))
      .sort();
    const remove = requests.slice(0, Math.max(0, requests.length - keep));
    for (const name of remove) unlinkSync(join(REQUEST_LOG_DIR, name));
    console.log(`[ end-pi ] cleaned request logs: removed=${remove.length}, kept=${requests.length - remove.length}`);
    console.log(`  Requests: ${REQUEST_LOG_DIR}`);
  } catch {
    console.log("[ end-pi ] no request logs found.");
  }
}

function parseKeepArg(defaultValue: number): number {
  const keepArg = args.find((arg) => /^--keep=\d+$/.test(arg));
  const keep = keepArg ? Number(keepArg.split("=")[1]) : defaultValue;
  return Number.isInteger(keep) && keep >= 0 ? keep : defaultValue;
}

function summarizeToolArgs(raw: unknown): string {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!value || typeof value !== "object") return "";
    const out: Record<string, unknown> = {};
    for (const key of ["cmd", "command", "workdir", "path", "session_id", "chars", "yield_time_ms"]) {
      if (key in value) out[key] = (value as any)[key];
    }
    const text = JSON.stringify(out);
    return text.length > 220 ? `${text.slice(0, 220)}...` : text;
  } catch {
    return typeof raw === "string" ? raw.slice(0, 220) : "";
  }
}

async function runDoctor(fix: boolean): Promise<void> {
  let report = await buildDoctorReport();

  if (fix && report.proxyActive) {
    try {
      const fixedPort = await ensureProxyDaemon();
      await applyProxy(fixedPort);
      setUserEnv("EP_API_KEY", "end-pi-local");
      if (!args.includes("--json")) console.log(`[ end-pi ] doctor --fix: proxy ensured on ${fixedPort}`);
      report = await buildDoctorReport();
    } catch (error: any) {
      if (!args.includes("--json")) console.log(`[ end-pi ] doctor --fix failed: ${error?.message ?? error}`);
    }
  }

  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\n[ end-pi ] Doctor`);
  for (const check of report.checks) {
    console.log(`  ${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
    if (!check.ok && check.hint) console.log(`      hint: ${check.hint}`);
  }
  console.log(`\n  Logs: ep logs --last-request | ep logs --requests | ep logs --lines=200 | ep logs --clean`);
  console.log(`  Smoke tests: ep smoke | ep smoke --matrix`);
}

async function buildDoctorReport(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const port = readSavedProxyPort();
  const active = isProxyActive();
  const daemon = await isProxyDaemonRunning(port);
  const auth = await readPiAuth().catch(() => null);
  const settings = await readPiSettings().catch(() => null);
  const nodeOk = compareVersions(process.versions.node, "22.19.0") >= 0;
  const piFound = commandExists("pi");
  const launchTarget = findCodexLaunchTarget();
  const multipass = isMultipassInstalled();
  const activeTokenCount = auth ? Object.values(auth).filter((entry) => !isTokenExpired(entry)).length : 0;

  checks.push({ name: "Node", ok: nodeOk, detail: process.versions.node, hint: "Install Node.js 22.19 or newer." });
  checks.push({ name: "Pi CLI", ok: piFound, detail: piFound ? "found" : "missing", hint: "Install Pi and authenticate providers." });
  checks.push({ name: "Codex config", ok: existsSync(join(CODEX_DIR, "config.toml")), detail: join(CODEX_DIR, "config.toml"), hint: "Open Codex Desktop once before running ep." });
  checks.push({ name: "Codex launch target", ok: Boolean(launchTarget) || process.platform !== "win32", detail: launchTarget ?? "not detected", hint: "Install or open Codex Desktop once." });
  checks.push({ name: "Pi auth", ok: Boolean(auth), detail: auth ? `${Object.keys(auth).length} provider(s)` : "missing", hint: "Run pi and log in to at least one provider." });
  checks.push({ name: "Pi model", ok: Boolean(settings?.defaultProvider && settings?.defaultModel), detail: `${settings?.defaultProvider ?? "?"}/${settings?.defaultModel ?? "?"}`, hint: "Use /model in Pi TUI." });
  checks.push({ name: "Active tokens", ok: activeTokenCount > 0, detail: auth ? `${activeTokenCount} active` : "unknown", hint: "Re-auth expired providers in Pi." });
  checks.push({ name: "Codex provider", ok: active, detail: active ? "end-pi active" : "native Codex", hint: "Run ep to switch Codex into end-pi mode." });
  checks.push({ name: "Proxy daemon", ok: daemon, detail: daemon ? `running on ${port}` : "stopped", hint: active ? "Run ep doctor --fix or ep." : "Run ep when ready to switch." });
  checks.push({ name: "Endpoint", ok: daemon ? await endpointHealthy(port) : true, detail: daemon ? `http://localhost:${port}/health` : "skipped (daemon stopped)", hint: "Check port conflict or stale daemon." });
  checks.push({ name: "Multi-pass", ok: multipass, detail: multipass ? "installed" : "not installed", hint: "Run ep setup if you want /subs, /pool, /mp-preset." });
  checks.push({ name: "Request logs", ok: true, detail: `${getRecentRequestLogs(5).length} recent`, hint: "Use ep logs --last-request after a failed Codex turn." });

  return {
    service: "end-pi",
    version: getCurrentPackageVersion(),
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    endpoint: `http://localhost:${port}/v1`,
    proxyActive: active,
    daemonRunning: daemon,
    paths: { codexDir: CODEX_DIR, logFile: LOG_FILE, requestLogDir: REQUEST_LOG_DIR },
    recentRequestLogs: getRecentRequestLogs(10).map((name) => join(REQUEST_LOG_DIR, name)),
    checks,
  };
}

function printSmokeChecklist(): void {
  if (args.includes("--matrix")) {
    printSmokeMatrix();
    return;
  }
  console.log(`\n[ end-pi ] Smoke checklist`);
  console.log(`  1. ep --version`);
  console.log(`  2. ep --status --no-update`);
  console.log(`  3. ep doctor --no-update`);
  console.log(`  4. ep --restore`);
  console.log(`  5. ep`);
  console.log(`  6. Ask Codex to find a real file or symbol in the current workspace.`);
  console.log(`  7. Attach an image and ask a vision-capable Pi model to read it.`);
  console.log(`  8. Switch Pi /model across providers and retry one tool task.`);
  console.log(`  9. ep logs --last-request after any failure.`);
  console.log(`\n  Full checklist: docs/REGRESSION.md`);
  console.log(`  Troubleshooting: docs/TROUBLESHOOTING.md`);
}

function printSmokeMatrix(): void {
  console.log(`\n[ end-pi ] Smoke matrix`);
  console.log(`  Run this once per Pi /model provider you care about:\n`);
  console.log(`  Provider/model      text   tools   image   restore   logs`);
  console.log(`  ------------------  -----  ------  ------  --------  ----`);
  console.log(`  Anthropic/Claude    [ ]    [ ]     [ ]     [ ]       [ ]`);
  console.log(`  OpenAI/Copilot      [ ]    [ ]     [ ]     [ ]       [ ]`);
  console.log(`  Google/Gemini       [ ]    [ ]     [ ]     [ ]       [ ]`);
  console.log(`  Antigravity         [ ]    [ ]     [ ]     [ ]       [ ]`);
  console.log(`  Other Pi provider   [ ]    [ ]     [ ]     [ ]       [ ]\n`);
  console.log(`  Text:    ask "what model are you using?"`);
  console.log(`  Tools:   ask Codex to find a real symbol in the workspace`);
  console.log(`  Image:   attach a small image and ask what text is visible`);
  console.log(`  Restore: run ep --restore, then ep`);
  console.log(`  Logs:    run ep logs --last-request after a failure`);
}

function commandExists(command: string): boolean {
  const lookup = process.platform === "win32" ? "where" : "which";
  return spawnSync(lookup, [command], { stdio: "ignore", windowsHide: true }).status === 0;
}

async function endpointHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1000) });
    const body = await res.json().catch(() => null) as { service?: string } | null;
    return res.ok && body?.service === "end-pi";
  } catch {
    return false;
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
  const port = await ensureProxyDaemon();
  const launchTarget = findCodexLaunchTarget();
  killCodexDesktop();
  await new Promise((r) => setTimeout(r, 1200));
  await applyProxy(port);
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
  if (code !== 0 && MULTIPASS_GIT_SPEC) {
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
    ...findPackageExtensionDirs(join(PI_AGENT_DIR, "git"), MULTIPASS_PACKAGE),
  ];

  return extensionDirs.some(hasMultipassExtension);
}

function findPackageExtensionDirs(root: string, packageName: string): string[] {
  const matches: string[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > 5) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (dir.endsWith(packageName)) matches.push(join(dir, "extensions"));
    for (const entry of entries) {
      if (entry.isDirectory()) visit(join(dir, entry.name), depth + 1);
    }
  };
  visit(root, 0);
  return matches;
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
  const port = getRequestedProxyPort();
  writeFileSync(PORT_FILE, String(port), "utf-8");
  daemonLog(`daemon starting pid=${process.pid}`);

  const server = serve({ fetch: app.fetch, port });
  daemonLog(`daemon listening http://localhost:${port}`);
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

async function ensureProxyDaemon(): Promise<number> {
  const runningPort = await findRunningProxyPort();
  if (runningPort) return runningPort;
  cleanupStaleProxyDaemon();
  const port = await chooseProxyPort();

  const child = spawn(process.execPath, selfArgs("--proxy-daemon"), {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, END_PI_PORT: String(port) },
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isProxyDaemonRunning(port)) return port;
  }

  throw new Error("Proxy daemon did not start. Run 'ep --status' or check ~/.codex/end-pi.log.");
}

function cleanupStaleProxyDaemon(): void {
  try {
    if (!existsSync(PID_FILE)) return;
    const pid = Number.parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    if (!Number.isFinite(pid) || pid <= 0) {
      unlinkSync(PID_FILE);
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
      daemonLog(`stale daemon pid=${pid} terminated`);
    } catch {
      daemonLog(`stale daemon pid=${pid} not running`);
    }
    unlinkSync(PID_FILE);
  } catch (error: any) {
    daemonLog(`stale daemon cleanup failed: ${error?.message ?? error}`);
  }
}

function selfArgs(...nextArgs: string[]): string[] {
  if (ENTRY_FILE.endsWith(".ts")) {
    const tsxCli = join(dirname(ENTRY_FILE), "..", "node_modules", "tsx", "dist", "cli.mjs");
    if (existsSync(tsxCli)) return [tsxCli, ENTRY_FILE, ...nextArgs];
  }
  return [ENTRY_FILE, ...nextArgs];
}

async function isProxyDaemonRunning(port = readSavedProxyPort()): Promise<boolean> {
  for (const host of ["localhost", "[::1]", "127.0.0.1"]) {
    try {
      const res = await fetch(`http://${host}:${port}/health`, { signal: AbortSignal.timeout(1000) });
      if (!res.ok) continue;
      const body = await res.json().catch(() => null) as { service?: string } | null;
      if (body?.service === "end-pi") return true;
    } catch { /* try next host */ }
  }
  return false;
}

async function findRunningProxyPort(): Promise<number | null> {
  const candidates = uniquePorts([readSavedProxyPort(), DEFAULT_PORT, ...readConfiguredCandidatePorts()]);
  for (const port of candidates) {
    if (await isProxyDaemonRunning(port)) return port;
  }
  return null;
}

function getRequestedProxyPort(): number {
  return parsePort(process.env.END_PI_PORT) ?? readSavedProxyPort();
}

function readSavedProxyPort(): number {
  return parsePort(process.env.END_PI_PORT) ?? parsePort(readText(PORT_FILE)) ?? DEFAULT_PORT;
}

function readConfiguredCandidatePorts(): number[] {
  const configPath = join(CODEX_DIR, "config.toml");
  const config = readText(configPath);
  if (!config) return [];
  return [...config.matchAll(/base_url\s*=\s*"http:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)\/v1"/g)]
    .map((match) => Number(match[1]))
    .filter((port) => Number.isInteger(port));
}

async function chooseProxyPort(): Promise<number> {
  const requested = parsePort(process.env.END_PI_PORT);
  if (requested) return requested;
  const candidates = uniquePorts([readSavedProxyPort(), DEFAULT_PORT, ...Array.from({ length: 59 }, (_, i) => DEFAULT_PORT + i + 1)]);
  for (const port of candidates) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error("No available local port found for end-pi proxy.");
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function parsePort(value: unknown): number | null {
  const port = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf-8").trim();
  } catch {
    return null;
  }
}

function uniquePorts(ports: number[]): number[] {
  return [...new Set(ports.filter((port) => Number.isInteger(port) && port > 0 && port < 65536))];
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
