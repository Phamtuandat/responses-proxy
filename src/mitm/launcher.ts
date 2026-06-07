/**
 * MITM Server Launcher — spawns the :443 HTTPS interception server as a
 * separate root process (via sudo) and manages its lifecycle.
 *
 * The MITM server needs root to bind to port 443 + write /etc/hosts, while the
 * main proxy daemon runs as a normal user. We spawn the compiled
 * `start-server.js` with `sudo -S` and feed the password via stdin.
 *
 * Because the spawned process runs as root, its `process.env.HOME` would point
 * to root's home — so we pass the resolved user MITM dir via
 * RESPONSES_PROXY_MITM_DIR so cert + model-mapping files resolve correctly.
 */

import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { existsSync, openSync } from "node:fs";
import path from "node:path";
import { getMitmDir } from "./cert.js";
import { isSudoAvailable } from "./dns.js";

const LOCAL_PORT = 443;

function startServerScriptPath(): string {
  // launcher.js lives in dist/mitm/, start-server.js is its sibling
  return fileURLToPath(new URL("./start-server.js", import.meta.url));
}

/** True if the MITM server is running (listening on :443).
 *  The server runs as root, so a normal-user `lsof` on the port can't see the
 *  socket — we detect via the process name (cross-user) and a TCP connect probe. */
export function isMitmServerListening(): boolean {
  // 1. Process check — matches the root-owned node process regardless of owner.
  try {
    const out = execSync(`pgrep -f "mitm/start-server.js"`, {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    if (out.length > 0) return true;
  } catch {
    /* not found via pgrep */
  }
  // 2. Fallback: any listener on 443 visible to this user.
  try {
    const out = execSync(`lsof -nP -iTCP:${LOCAL_PORT} -sTCP:LISTEN -t`, {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

/**
 * Spawn the MITM server on :443. Resolves once it is listening, rejects on
 * failure (bad password, missing script, bind error) within a timeout.
 */
export function startMitmServerProcess(password?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isMitmServerListening()) return resolve();

    const script = startServerScriptPath();
    if (!existsSync(script)) {
      return reject(new Error(`MITM server script not found: ${script}`));
    }

    const mitmDir = getMitmDir();
    const logPath = path.join(mitmDir, "mitm-server.log");
    let logFd: number | undefined;
    try {
      logFd = openSync(logPath, "a");
    } catch {
      logFd = undefined;
    }

    const env = {
      ...process.env,
      RESPONSES_PROXY_MITM_DIR: mitmDir,
      MITM_ROUTER_BASE_URL:
        process.env.MITM_ROUTER_BASE_URL || `http://localhost:${process.env.PORT || 8318}`,
    };

    const useSudo = isSudoAvailable();
    const nodeBin = process.execPath;
    const cmd = useSudo ? "sudo" : nodeBin;
    // -E preserves env (incl. RESPONSES_PROXY_MITM_DIR), -S reads password from stdin
    const args = useSudo ? ["-S", "-E", nodeBin, script] : [script];

    const child = spawn(cmd, args, {
      detached: true,
      stdio: ["pipe", logFd ?? "ignore", "pipe"],
      env,
    });

    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    if (useSudo && child.stdin) {
      child.stdin.write(`${password ?? ""}\n`);
      child.stdin.end();
    }

    child.on("error", (e) => reject(e));

    const startedAt = Date.now();
    const poll = setInterval(() => {
      if (isMitmServerListening()) {
        clearInterval(poll);
        child.unref();
        resolve();
      } else if (Date.now() - startedAt > 7000) {
        clearInterval(poll);
        const lower = stderr.toLowerCase();
        if (lower.includes("incorrect password") || lower.includes("try again") || lower.includes("sorry")) {
          reject(new Error("Incorrect sudo password"));
        } else if (lower.includes("eacces") || lower.includes("permission denied")) {
          reject(new Error("Permission denied for port 443. Run with sudo."));
        } else {
          reject(new Error(stderr.trim() || "MITM server failed to start (port 443)"));
        }
      }
    }, 300);
  });
}

/** Kill the MITM server process(es) listening on :443. */
export function stopMitmServerProcess(password?: string): Promise<void> {
  return new Promise((resolve) => {
    if (!isMitmServerListening()) return resolve();

    const killCmd = `lsof -nP -iTCP:${LOCAL_PORT} -sTCP:LISTEN -t | xargs kill -9 2>/dev/null; pkill -f "mitm/start-server.js" 2>/dev/null; true`;
    const useSudo = isSudoAvailable();

    if (useSudo) {
      const child = spawn("sudo", ["-S", "sh", "-c", killCmd], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      if (child.stdin) {
        child.stdin.write(`${password ?? ""}\n`);
        child.stdin.end();
      }
      child.on("close", () => resolve());
      child.on("error", () => resolve());
    } else {
      try {
        execSync(killCmd, { stdio: "ignore" });
      } catch {
        /* ignore */
      }
      resolve();
    }
  });
}
