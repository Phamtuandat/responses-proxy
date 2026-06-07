#!/usr/bin/env node
/**
 * responses-proxy CLI — full command interface for managing the proxy.
 *
 * Usage:
 *   responses-proxy                     # Start foreground, open browser
 *   responses-proxy --background        # Start as background daemon
 *   responses-proxy stop                # Stop daemon
 *   responses-proxy status              # Check running state
 *   responses-proxy restart             # Restart daemon
 *   responses-proxy logs                # Tail server logs
 *   responses-proxy config              # Show current config
 *   responses-proxy config set KEY VAL  # Set env config
 *   responses-proxy setup               # Interactive first-time setup
 *   responses-proxy password <pass>     # Set dashboard password
 *   responses-proxy info                # Show connection details (endpoint + key)
 */

const { spawn, exec, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const readline = require("readline");

const pkg = require("./package.json");
const args = process.argv.slice(2);

// ─── Paths ───────────────────────────────────────────────────────────────────

const dataDir = path.join(os.homedir(), ".responses-proxy");
fs.mkdirSync(dataDir, { recursive: true });
const PID_FILE = path.join(dataDir, "server.pid");
const LOG_FILE = path.join(dataDir, "server.log");
const ENV_FILE = path.join(dataDir, "config.env");
const serverPath = path.join(__dirname, "dist", "server.js");
const nodeModulesPath = path.join(__dirname, "dist", "node_modules");

// ─── Config ──────────────────────────────────────────────────────────────────

function loadEnvConfig() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const lines = fs.readFileSync(ENV_FILE, "utf8").split("\n");
  const env = {};
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env;
}

function saveEnvConfig(env) {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, lines.join("\n") + "\n");
}

function getConfig(key) {
  const env = loadEnvConfig();
  return env[key] || process.env[key] || "";
}

function setConfig(key, value) {
  const env = loadEnvConfig();
  env[key] = value;
  saveEnvConfig(env);
}

// ─── Parse args ──────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8318;
let port = parseInt(getConfig("PORT")) || DEFAULT_PORT;
let host = getConfig("HOST") || "0.0.0.0";
let noBrowser = false;
let background = false;
let subcommand = null;
let subArgs = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--port" || arg === "-p") { port = parseInt(args[++i], 10) || DEFAULT_PORT; }
  else if (arg === "--host" || arg === "-H") { host = args[++i] || "0.0.0.0"; }
  else if (arg === "--no-browser" || arg === "-n") { noBrowser = true; }
  else if (arg === "--background" || arg === "--bg" || arg === "-b" || arg === "--daemon") { background = true; }
  else if (arg === "--help" || arg === "-h") { printHelp(); process.exit(0); }
  else if (arg === "--version" || arg === "-v") { console.log(pkg.version); process.exit(0); }
  else if (!arg.startsWith("-")) {
    subcommand = arg;
    subArgs = args.slice(i + 1);
    break;
  }
}

function printHelp() {
  console.log(`
responses-proxy v${pkg.version} — AI Routing Proxy

Usage: responses-proxy [command] [options]

Commands:
  (none)                Start the server (foreground)
  stop                  Stop the background daemon
  status                Check if running
  restart               Restart background daemon
  logs                  Show recent server logs
  info                  Show endpoint URL + API key
  config                Show all config
  config set KEY VALUE  Set a config value
  config get KEY        Get a config value
  setup                 Interactive first-time setup wizard
  password <pass>       Set dashboard admin password
  open                  Open dashboard in browser

Options:
  -p, --port <port>     Port (default: ${DEFAULT_PORT})
  -H, --host <host>     Host (default: 0.0.0.0)
  -n, --no-browser      Don't auto-open browser
  -b, --background      Run as background daemon
  -h, --help            Show help
  -v, --version         Show version

Data directory: ${dataDir}
Config file:    ${ENV_FILE}
`);
}

// ─── Subcommand dispatch ─────────────────────────────────────────────────────

if (subcommand === "stop") { stopDaemon(); process.exit(0); }
if (subcommand === "status") { checkStatus(); process.exit(0); }
if (subcommand === "restart") { stopDaemon(); background = true; }
if (subcommand === "logs") { showLogs(); process.exit(0); }
if (subcommand === "info") { showInfo(); process.exit(0); }
if (subcommand === "open") { openDashboard(); process.exit(0); }
if (subcommand === "config") { handleConfig(); process.exit(0); }
if (subcommand === "password") { handlePassword(); process.exit(0); }
if (subcommand === "setup") { runSetup().then(() => process.exit(0)); }
else if (subcommand && !["restart"].includes(subcommand)) {
  console.error(`Unknown command: ${subcommand}\nRun 'responses-proxy --help' for usage.`);
  process.exit(1);
}

// ─── Subcommand implementations ──────────────────────────────────────────────

function getDaemonPid() {
  try {
    if (!fs.existsSync(PID_FILE)) return null;
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf8").trim(), 10);
    if (!pid) return null;
    process.kill(pid, 0);
    return pid;
  } catch {
    try { fs.unlinkSync(PID_FILE); } catch {}
    return null;
  }
}

function stopDaemon() {
  const pid = getDaemonPid();
  if (!pid) { console.log("⏹  Not running."); return; }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`⏹  Stopped (PID: ${pid})`);
    try { fs.unlinkSync(PID_FILE); } catch {}
  } catch (e) { console.error(`Failed: ${e.message}`); }
}

function checkStatus() {
  const pid = getDaemonPid();
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  if (pid) {
    console.log(`✅ Running (PID: ${pid})`);
    console.log(`   Endpoint:  http://${displayHost}:${port}/v1`);
    console.log(`   Dashboard: http://${displayHost}:${port}/`);
    console.log(`   Data:      ${dataDir}`);
  } else {
    console.log("⏹  Not running.");
  }
}

function showLogs() {
  if (!fs.existsSync(LOG_FILE)) { console.log("No logs yet."); return; }
  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n");
  console.log(lines.slice(-80).join("\n"));
}

function showInfo() {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const password = getConfig("DASHBOARD_PASSWORD") || "admin";
  console.log(`
┌─────────────────────────────────────────┐
│  responses-proxy v${pkg.version.padEnd(25)}│
├─────────────────────────────────────────┤
│  Endpoint:  http://${displayHost}:${port}/v1${" ".repeat(Math.max(0, 18 - String(port).length))}│
│  Dashboard: http://${displayHost}:${port}/${" ".repeat(Math.max(0, 20 - String(port).length))}│
│  Password:  ${password.padEnd(27)}│
├─────────────────────────────────────────┤
│  For Claude Code:                       │
│  export ANTHROPIC_BASE_URL=http://${displayHost}:${port}/v1
│  export ANTHROPIC_API_KEY=sk_anything   │
├─────────────────────────────────────────┤
│  For Codex / OpenAI SDK:                │
│  base_url = http://${displayHost}:${port}/v1${" ".repeat(Math.max(0, 18 - String(port).length))}│
│  api_key  = sk_anything                 │
└─────────────────────────────────────────┘
`);
}

function openDashboard() {
  const displayHost = host === "0.0.0.0" ? "localhost" : host;
  const url = `http://${displayHost}:${port}`;
  const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, { windowsHide: true }, () => {});
  console.log(`Opening ${url}`);
}

function handleConfig() {
  if (subArgs[0] === "set" && subArgs[1]) {
    setConfig(subArgs[1], subArgs.slice(2).join(" "));
    console.log(`✅ ${subArgs[1]} = ${subArgs.slice(2).join(" ")}`);
  } else if (subArgs[0] === "get" && subArgs[1]) {
    console.log(getConfig(subArgs[1]) || "(not set)");
  } else {
    const env = loadEnvConfig();
    console.log(`Config file: ${ENV_FILE}\n`);
    if (Object.keys(env).length === 0) {
      console.log("  (empty — using defaults)");
      console.log(`\n  Default port: ${DEFAULT_PORT}`);
      console.log(`  Default password: admin`);
      console.log(`\n  Set values with: responses-proxy config set KEY VALUE`);
    } else {
      for (const [k, v] of Object.entries(env)) {
        console.log(`  ${k} = ${v}`);
      }
    }
    console.log(`\nAvailable keys:`);
    console.log(`  PORT                    Server port (default: 8318)`);
    console.log(`  HOST                    Bind host (default: 0.0.0.0)`);
    console.log(`  DASHBOARD_PASSWORD      Admin password (default: admin)`);
    console.log(`  UPSTREAM_BASE_URL       Default upstream provider URL`);
    console.log(`  UPSTREAM_API_KEY        Default upstream API key`);
    console.log(`  KIRO_ENABLED            Enable Kiro provider (true/false)`);
    console.log(`  KIRO_DB_PATH            Path to 9router kiro.sqlite`);
  }
}

function handlePassword() {
  const pass = subArgs[0];
  if (!pass) {
    console.log(`Current password: ${getConfig("DASHBOARD_PASSWORD") || "admin"}`);
    console.log(`\nUsage: responses-proxy password <new-password>`);
    return;
  }
  setConfig("DASHBOARD_PASSWORD", pass);
  console.log(`✅ Dashboard password set to: ${pass}`);
  console.log(`   Restart the server for changes to take effect.`);
}

async function runSetup() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(`\n🚀 responses-proxy Setup Wizard\n`);

  const portAnswer = await ask(`Port [${port}]: `);
  if (portAnswer.trim()) setConfig("PORT", portAnswer.trim());

  const passAnswer = await ask(`Dashboard password [admin]: `);
  if (passAnswer.trim()) setConfig("DASHBOARD_PASSWORD", passAnswer.trim());

  const kiroAnswer = await ask(`Enable Kiro provider? (y/n) [y]: `);
  if (kiroAnswer.trim().toLowerCase() === "n") setConfig("KIRO_ENABLED", "false");
  else setConfig("KIRO_ENABLED", "true");

  const upstreamAnswer = await ask(`Default upstream URL (leave empty to skip): `);
  if (upstreamAnswer.trim()) setConfig("UPSTREAM_BASE_URL", upstreamAnswer.trim());

  const keyAnswer = await ask(`Default upstream API key (leave empty to skip): `);
  if (keyAnswer.trim()) setConfig("UPSTREAM_API_KEY", keyAnswer.trim());

  rl.close();

  console.log(`\n✅ Config saved to ${ENV_FILE}`);
  console.log(`\nStart the server with:`);
  console.log(`   responses-proxy`);
  console.log(`   responses-proxy --background`);
  console.log(`\nView connection info:`);
  console.log(`   responses-proxy info\n`);
}

// ─── If subcommand was handled above (setup is async), bail ──────────────────
if (subcommand === "setup") { /* runSetup handles exit */ return; }
if (subcommand && subcommand !== "restart") process.exit(0);

// ─── Ensure deps ─────────────────────────────────────────────────────────────

if (!fs.existsSync(serverPath)) {
  console.error("Error: Built server not found. Reinstall the package.");
  process.exit(1);
}

if (!fs.existsSync(path.join(nodeModulesPath, "fastify"))) {
  console.log("📦 Installing runtime dependencies...");
  try {
    execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", {
      cwd: path.join(__dirname, "dist"), stdio: "inherit", timeout: 120000,
    });
  } catch {
    console.error("Failed to install deps. Run: cd " + path.join(__dirname, "dist") + " && npm install --omit=dev");
    process.exit(1);
  }
}

// ─── Kill existing ───────────────────────────────────────────────────────────

const existingPid = getDaemonPid();
if (existingPid) {
  try { process.kill(existingPid, "SIGTERM"); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
  try { execSync("sleep 1", { stdio: "ignore" }); } catch {}
}

// Also kill any process on the target port (handles stale processes)
try {
  const portPids = execSync(`lsof -ti:${port}`, { encoding: "utf8", timeout: 3000 }).trim();
  if (portPids) {
    portPids.split("\n").forEach((p) => {
      try { process.kill(Number(p), "SIGKILL"); } catch {}
    });
    execSync("sleep 1", { stdio: "ignore" });
  }
} catch { /* port is free */ }

// ─── Build env ───────────────────────────────────────────────────────────────

fs.mkdirSync(path.join(dataDir, "sessions"), { recursive: true });
const userConfig = loadEnvConfig();

const serverEnv = {
  ...process.env,
  ...userConfig,
  NODE_PATH: nodeModulesPath,
  PORT: String(port),
  HOST: host,
  UPSTREAM_BASE_URL: userConfig.UPSTREAM_BASE_URL || process.env.UPSTREAM_BASE_URL || "https://placeholder.invalid",
  UPSTREAM_API_KEY: userConfig.UPSTREAM_API_KEY || process.env.UPSTREAM_API_KEY || "",
  APP_DB_PATH: path.join(dataDir, "app.sqlite"),
  SESSION_LOG_DIR: path.join(dataDir, "sessions"),
  CUSTOMER_KEY_DB_PATH: path.join(dataDir, "telegram-bot.sqlite"),
  KIRO_DB_PATH: userConfig.KIRO_DB_PATH || path.join(dataDir, "kiro.sqlite"),
  KIRO_ENABLED: userConfig.KIRO_ENABLED || process.env.KIRO_ENABLED || "true",
  QUICK_APPLY_HERMES_CONFIG_PATH: path.join(os.homedir(), ".hermes", "config.yaml"),
  QUICK_APPLY_CODEX_CONFIG_PATH: path.join(os.homedir(), ".codex", "config.toml"),
  QUICK_APPLY_CODEX_AUTH_PATH: path.join(os.homedir(), ".codex", "auth.json"),
  TELEGRAM_BOT_TOKEN: userConfig.TELEGRAM_BOT_TOKEN || "",
  TELEGRAM_OWNER_USER_IDS: userConfig.TELEGRAM_OWNER_USER_IDS || "",
  TELEGRAM_ADMIN_USER_IDS: userConfig.TELEGRAM_ADMIN_USER_IDS || "",
  DASHBOARD_PASSWORD: userConfig.DASHBOARD_PASSWORD || process.env.DASHBOARD_PASSWORD || "admin",
};

const displayHost = host === "0.0.0.0" ? "localhost" : host;
const url = `http://${displayHost}:${port}`;

// ─── Background mode ─────────────────────────────────────────────────────────

if (background) {
  const logFd = fs.openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [serverPath], {
    cwd: __dirname, env: serverEnv,
    stdio: ["ignore", logFd, logFd],
    detached: true,
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  fs.closeSync(logFd);

  console.log(`
┌─────────────────────────────────────────┐
│  responses-proxy v${pkg.version.padEnd(25)}│
│  Running in background (PID: ${String(child.pid).padEnd(10)}│
│  ${url.padEnd(39)}│
│  Dashboard: ${(url + "/").padEnd(27)}│
│  API: ${(url + "/v1").padEnd(33)}│
├─────────────────────────────────────────┤
│  Stop:    responses-proxy stop          │
│  Status:  responses-proxy status        │
│  Logs:    responses-proxy logs          │
│  Config:  responses-proxy config        │
│  Info:    responses-proxy info          │
└─────────────────────────────────────────┘
`);

  if (!noBrowser) {
    setTimeout(() => {
      const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
      exec(cmd, { windowsHide: true }, () => {});
    }, 2000);
  }
  setTimeout(() => process.exit(0), 2500);

} else {
  // ─── Foreground mode ───────────────────────────────────────────────────────

  console.log(`
┌─────────────────────────────────────────┐
│  responses-proxy v${pkg.version.padEnd(25)}│
│  ${url.padEnd(39)}│
│  Dashboard: ${(url + "/").padEnd(27)}│
│  API: ${(url + "/v1").padEnd(33)}│
│  Press Ctrl+C to stop                  │
└─────────────────────────────────────────┘
`);

  const server = spawn(process.execPath, [serverPath], {
    cwd: __dirname, stdio: "inherit", env: serverEnv,
  });
  fs.writeFileSync(PID_FILE, String(server.pid));

  if (!noBrowser) {
    setTimeout(() => {
      const cmd = process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
      exec(cmd, { windowsHide: true }, () => {});
    }, 2000);
  }

  function cleanup() {
    try { fs.unlinkSync(PID_FILE); } catch {}
    if (server.pid) { try { process.kill(server.pid, "SIGTERM"); } catch {} }
  }
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  server.on("close", (code) => { try { fs.unlinkSync(PID_FILE); } catch {} process.exit(code || 0); });
}
