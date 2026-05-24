import { execFileSync, spawn } from "child_process";

export function setUserEnv(name: string, value: string): void {
  process.env[name] = value;

  if (process.platform === "win32") {
    runQuiet("powershell", [
      "-NoProfile",
      "-Command",
      `[System.Environment]::SetEnvironmentVariable('${escapePowerShell(name)}', '${escapePowerShell(value)}', 'User')`,
    ]);
    return;
  }

  if (process.platform === "darwin") {
    runQuiet("launchctl", ["setenv", name, value]);
    return;
  }

  runQuiet("systemctl", ["--user", "set-environment", `${name}=${value}`]);
  runQuiet("dbus-update-activation-environment", ["--systemd", name]);
}

export function unsetUserEnv(name: string): void {
  delete process.env[name];

  if (process.platform === "win32") {
    runQuiet("powershell", [
      "-NoProfile",
      "-Command",
      `[System.Environment]::SetEnvironmentVariable('${escapePowerShell(name)}', $null, 'User')`,
    ]);
    return;
  }

  if (process.platform === "darwin") {
    runQuiet("launchctl", ["unsetenv", name]);
    return;
  }

  runQuiet("systemctl", ["--user", "unset-environment", name]);
}

export function killCodexDesktop(): boolean {
  if (process.platform === "win32") {
    return runQuiet("taskkill", ["/IM", "Codex.exe", "/F"]);
  }

  if (process.platform === "darwin") {
    const quit = runQuiet("osascript", ["-e", 'tell application "Codex" to quit']);
    const killed = runQuiet("pkill", ["-f", "/Codex.app/"]);
    return quit || killed;
  }

  return runQuiet("pkill", ["-f", "codex.*desktop"]) ||
    runQuiet("pkill", ["-f", "Codex"]);
}

export async function restartCodexDesktop(): Promise<boolean> {
  const launchTarget = findCodexLaunchTarget();
  killCodexDesktop();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return launchCodexDesktop(launchTarget);
}

export function launchCodexDesktop(launchTarget?: string): boolean {
  if (process.platform === "win32") {
    if (launchTarget) return spawnGuiDetached(launchTarget, []);
    return runQuiet("explorer.exe", ["shell:AppsFolder\\OpenAI.Codex_2p2nqsd0c76g0!App"]);
  }

  if (process.platform === "darwin") {
    if (launchTarget) return spawnGuiDetached(launchTarget, []);
    return runQuiet("open", ["-a", "Codex"]);
  }

  if (launchTarget && spawnGuiDetached(launchTarget, [])) return true;
  return spawnDetached("codex", []) ||
    spawnDetached("codex-desktop", []) ||
    spawnDetached("Codex", []);
}

export function stopProcess(pid: number): boolean {
  try {
    process.kill(pid, "SIGTERM");
    return true;
  } catch {
    if (process.platform === "win32") {
      return runQuiet("taskkill", ["/PID", String(pid), "/F"]);
    }
    return false;
  }
}

export function getProcessCommandLine(pid: number): string {
  if (process.platform === "win32") {
    try {
      return execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { $p.CommandLine }`,
      ], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    } catch {
      return "";
    }
  }

  if (process.platform === "darwin") {
    try {
      return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return "";
    }
  }

  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

export function runQuiet(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export function findCodexLaunchTarget(): string | undefined {
  if (process.platform === "win32") {
    try {
      const path = execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        "Get-Process -Name Codex -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like '*.exe' } | Sort-Object { $_.Path -like '*WindowsApps*' } -Descending | Select-Object -First 1 -ExpandProperty Path",
      ], { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim();
      return path || undefined;
    } catch {
      return undefined;
    }
  }

  const psArgs = process.platform === "darwin"
    ? ["-axo", "command="]
    : ["-eo", "args="];
  try {
    const lines = execFileSync("ps", psArgs, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).split("\n");
    const match = lines
      .map((line) => line.trim())
      .find((line) => /(^|\/)(Codex|codex)(\.app\/Contents\/MacOS\/[^ ]+|$| )/.test(line));
    if (!match) return undefined;
    const firstArg = match.match(/^"([^"]+)"/)?.[1] ?? match.split(/\s+/, 1)[0];
    return firstArg || undefined;
  } catch {
    return undefined;
  }
}

function spawnDetached(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function spawnGuiDetached(command: string, args: string[]): boolean {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}
