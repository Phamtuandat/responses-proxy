/**
 * MITM DNS Management — manages /etc/hosts entries to redirect tool domains to localhost.
 */

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const IS_WIN = process.platform === "win32";
const IS_MAC = process.platform === "darwin";
const HOSTS_FILE = IS_WIN
  ? `${process.env.SystemRoot || "C:\\Windows"}\\System32\\drivers\\etc\\hosts`
  : "/etc/hosts";

// Tool domains to intercept
export const TOOL_HOSTS: Record<string, string[]> = {
  antigravity: ["daily-cloudcode-pa.googleapis.com", "cloudcode-pa.googleapis.com"],
  copilot: ["api.individual.githubcopilot.com"],
  kiro: ["q.us-east-1.amazonaws.com"],
};

export function isSudoAvailable(): boolean {
  if (IS_WIN) return false;
  try {
    execSync("command -v sudo", { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function canRunSudoWithoutPassword(): boolean {
  if (IS_WIN || !isSudoAvailable()) return true;
  try {
    execSync("sudo -n true", { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function isSudoPasswordRequired(): boolean {
  return !IS_WIN && isSudoAvailable() && !canRunSudoWithoutPassword();
}

export function execWithPassword(command: string, password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const useSudo = isSudoAvailable();
    const child = useSudo
      ? spawn("sudo", ["-S", "sh", "-c", command], { stdio: ["pipe", "pipe", "pipe"] })
      : spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d; });
    child.stderr?.on("data", (d: Buffer) => { stderr += d; });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `Exit code ${code}`));
    });
    if (useSudo && child.stdin) {
      child.stdin.write(`${password}\n`);
      child.stdin.end();
    }
  });
}

function checkDNSEntry(host: string): boolean {
  try {
    const content = readFileSync(HOSTS_FILE, "utf8");
    return content.includes(host);
  } catch {
    return false;
  }
}

export function checkAllDNSStatus(): Record<string, boolean> {
  try {
    const content = readFileSync(HOSTS_FILE, "utf8");
    const result: Record<string, boolean> = {};
    for (const [tool, hosts] of Object.entries(TOOL_HOSTS)) {
      result[tool] = hosts.every((h) => content.includes(h));
    }
    return result;
  } catch {
    return Object.fromEntries(Object.keys(TOOL_HOSTS).map((t) => [t, false]));
  }
}

async function flushDNS(sudoPassword: string): Promise<void> {
  if (IS_WIN) return;
  if (IS_MAC) {
    await execWithPassword("dscacheutil -flushcache && killall -HUP mDNSResponder", sudoPassword);
  } else {
    await execWithPassword("resolvectl flush-caches 2>/dev/null || true", sudoPassword);
  }
}

export async function addDNSEntry(tool: string, sudoPassword: string): Promise<void> {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToAdd = hosts.filter((h) => !checkDNSEntry(h));
  if (entriesToAdd.length === 0) return;

  const current = readFileSync(HOSTS_FILE, "utf8");
  const trimmed = current.replace(/[\r\n\s]+$/g, "");
  const toAppend = entriesToAdd.map((h) => `127.0.0.1 ${h}`).join("\n");
  const next = `${trimmed}\n${toAppend}\n`;

  const escaped = next.replace(/'/g, "'\\''");
  await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
  await flushDNS(sudoPassword);
}

export async function removeDNSEntry(tool: string, sudoPassword: string): Promise<void> {
  const hosts = TOOL_HOSTS[tool];
  if (!hosts) throw new Error(`Unknown tool: ${tool}`);

  const entriesToRemove = hosts.filter((h) => checkDNSEntry(h));
  if (entriesToRemove.length === 0) return;

  const current = readFileSync(HOSTS_FILE, "utf8");
  const filtered = current
    .split(/\r?\n/)
    .filter((l) => !entriesToRemove.some((h) => l.includes(h)))
    .join("\n");
  const next = filtered.replace(/[\r\n\s]+$/g, "") + "\n";

  const escaped = next.replace(/'/g, "'\\''");
  await execWithPassword(`printf '%s' '${escaped}' | tee ${HOSTS_FILE} > /dev/null`, sudoPassword);
  await flushDNS(sudoPassword);
}

export function removeAllDNSEntriesSync(): void {
  try {
    if (!existsSync(HOSTS_FILE)) return;
    const allHosts = Object.values(TOOL_HOSTS).flat();
    const content = readFileSync(HOSTS_FILE, "utf8");
    const filtered = content
      .split(/\r?\n/)
      .filter((l) => !allHosts.some((h) => l.includes(h)))
      .join("\n");
    const next = filtered.replace(/[\r\n\s]+$/g, "") + "\n";
    if (next === content) return;
    writeFileSync(HOSTS_FILE, next, "utf8");
    if (IS_MAC) {
      try { execSync("dscacheutil -flushcache && killall -HUP mDNSResponder", { stdio: "ignore" }); } catch { /* ignore */ }
    }
  } catch { /* best effort during shutdown */ }
}
