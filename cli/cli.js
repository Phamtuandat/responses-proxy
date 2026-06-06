#!/usr/bin/env node
/**
 * responses-proxy CLI — starts the proxy server and opens the dashboard.
 *
 * Usage:
 *   npx responses-proxy
 *   responses-proxy --port 8318
 *   responses-proxy --no-browser
 */

const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const pkg = require("./package.json");
const args = process.argv.slice(2);

// Defaults
const DEFAULT_PORT = 8318;
let port = DEFAULT_PORT;
let host = "0.0.0.0";
let noBrowser = false;

// Parse args
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--port" || args[i] === "-p") {
    port = parseInt(args[i + 1], 10) || DEFAULT_PORT;
    i++;
  } else if (args[i] === "--host" || args[i] === "-H") {
    host = args[i + 1] || "0.0.0.0";
    i++;
  } else if (args[i] === "--no-browser" || args[i] === "-n") {
    noBrowser = true;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log(`
responses-proxy v${pkg.version}

Usage: responses-proxy [options]

Options:
  -p, --port <port>   Port to run the server (default: ${DEFAULT_PORT})
  -H, --host <host>   Host to bind (default: 0.0.0.0)
  -n, --no-browser    Don't open browser automatically
  -h, --help          Show this help message
  -v, --version       Show version
`);
    process.exit(0);
  } else if (args[i] === "--version" || args[i] === "-v") {
    console.log(pkg.version);
    process.exit(0);
  }
}

// Resolve paths
const serverPath = path.join(__dirname, "dist", "server.js");

if (!fs.existsSync(serverPath)) {
  console.error("Error: Built server not found at", serverPath);
  console.error("Run 'npm run build' first, or reinstall the package.");
  process.exit(1);
}

// Check if deps are installed
const nodeModulesPath = path.join(__dirname, "dist", "node_modules");
if (!fs.existsSync(path.join(nodeModulesPath, "fastify"))) {
  console.log("📦 Runtime deps missing. Installing...");
  const { execSync } = require("child_process");
  try {
    execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", {
      cwd: path.join(__dirname, "dist"),
      stdio: "inherit",
      timeout: 120000,
    });
  } catch {
    console.error("Failed to install deps. Run: cd " + path.join(__dirname, "dist") + " && npm install --omit=dev");
    process.exit(1);
  }
}

// Data directory
const dataDir = path.join(os.homedir(), ".responses-proxy");
fs.mkdirSync(path.join(dataDir, "sessions"), { recursive: true });

const displayHost = host === "0.0.0.0" ? "localhost" : host;
const url = `http://${displayHost}:${port}`;

console.log(`
┌─────────────────────────────────────────┐
│  responses-proxy v${pkg.version.padEnd(25)}│
│  ${url.padEnd(39)}│
│  Dashboard: ${(url + "/").padEnd(27)}│
│  API: ${(url + "/v1").padEnd(33)}│
└─────────────────────────────────────────┘
`);

// Spawn server
const server = spawn(process.execPath, [serverPath], {
  cwd: __dirname,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_PATH: nodeModulesPath,
    PORT: String(port),
    HOST: host,
    UPSTREAM_BASE_URL: process.env.UPSTREAM_BASE_URL || "https://placeholder.invalid",
    UPSTREAM_API_KEY: process.env.UPSTREAM_API_KEY || "",
    APP_DB_PATH: path.join(dataDir, "app.sqlite"),
    SESSION_LOG_DIR: path.join(dataDir, "sessions"),
    CUSTOMER_KEY_DB_PATH: path.join(dataDir, "telegram-bot.sqlite"),
    KIRO_DB_PATH: path.join(dataDir, "kiro.sqlite"),
    KIRO_ENABLED: process.env.KIRO_ENABLED || "false",
    QUICK_APPLY_HERMES_CONFIG_PATH: path.join(os.homedir(), ".hermes", "config.yaml"),
    QUICK_APPLY_CODEX_CONFIG_PATH: path.join(os.homedir(), ".codex", "config.toml"),
    QUICK_APPLY_CODEX_AUTH_PATH: path.join(os.homedir(), ".codex", "auth.json"),
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_OWNER_USER_IDS: "",
    TELEGRAM_ADMIN_USER_IDS: "",
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || "admin",
  },
});

// Open browser after short delay
if (!noBrowser) {
  setTimeout(() => {
    const openCmd =
      process.platform === "darwin" ? `open "${url}"` :
      process.platform === "win32" ? `start "" "${url}"` :
      `xdg-open "${url}"`;
    exec(openCmd, { windowsHide: true }, () => {});
  }, 2000);
}

// Handle exit
function cleanup() {
  if (server.pid) {
    try { process.kill(server.pid, "SIGTERM"); } catch {}
  }
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

server.on("close", (code) => {
  process.exit(code || 0);
});
