/**
 * MITM Proxy Server — intercepts HTTPS on port 443 with dynamic SSL certs.
 *
 * Cloned from 9Router's src/mitm/server.js approach:
 * - HTTPS server on :443 with SNI callback for per-domain certs
 * - Intercepts requests to tool domains (Antigravity, Copilot, Kiro)
 * - Rewrites model in request body to mapped model from proxy
 * - Forwards to real upstream via HTTPS with custom DNS (bypass /etc/hosts loop)
 */

import * as https from "node:https";
import * as tls from "node:tls";
import * as dns from "node:dns";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { generateLeafCert, loadRootCA, rootCaExists, getMitmDir } from "./cert.js";
import { TOOL_HOSTS, removeAllDNSEntriesSync } from "./dns.js";
import { resolveModelRouting } from "./model-mappings.js";

const LOCAL_PORT = 443;
const MITM_DIR = getMitmDir();
const PID_FILE = path.join(MITM_DIR, ".mitm.pid");

// Tool detection from host header
const HOST_TO_TOOL: Record<string, string> = {};
for (const [tool, hosts] of Object.entries(TOOL_HOSTS)) {
  for (const h of hosts) HOST_TO_TOOL[h] = tool;
}

// Proxy base URL — requests are forwarded to responses-proxy for model routing
const ROUTER_BASE_URL = process.env.MITM_ROUTER_BASE_URL || "http://localhost:8318";

// Internal header to prevent loop
const INTERNAL_HEADER = "x-request-source";
const INTERNAL_VALUE = "mitm-local";

// Sentinel provider id used in model mappings to denote a model-combo reference.
const COMBO_PROVIDER = "__combo__";

// ─── SSL / SNI ───────────────────────────────────────────────────────────────

const certCache = new Map<string, tls.SecureContext>();
let rootCAPem: string;

function sniCallback(servername: string, cb: (err: Error | null, ctx?: tls.SecureContext) => void) {
  try {
    if (certCache.has(servername)) return cb(null, certCache.get(servername)!);
    const certData = generateLeafCert(servername);
    if (!certData) return cb(new Error(`Failed to generate cert for ${servername}`));
    const ctx = tls.createSecureContext({
      key: certData.key,
      cert: `${certData.cert}\n${rootCAPem}`,
    });
    certCache.set(servername, ctx);
    cb(null, ctx);
  } catch (e: any) {
    cb(e);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const resolve4 = promisify((() => {
  const resolver = new dns.Resolver();
  resolver.setServers(["8.8.8.8", "1.1.1.1"]);
  return resolver.resolve4.bind(resolver);
})());

const ipCache: Record<string, { ip: string; ts: number }> = {};
async function resolveTargetIP(hostname: string): Promise<string> {
  const cached = ipCache[hostname];
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.ip;
  const addresses = await resolve4(hostname);
  ipCache[hostname] = { ip: addresses[0], ts: Date.now() };
  return addresses[0];
}

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ─── Request handler ─────────────────────────────────────────────────────────

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    // Health check
    if (req.url === "/_mitm_health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, pid: process.pid }));
      return;
    }

    const bodyBuffer = await collectBody(req);

    // Anti-loop: skip our own requests
    if (req.headers[INTERNAL_HEADER] === INTERNAL_VALUE) {
      return passthrough(req, res, bodyBuffer);
    }

    const host = (req.headers.host || "").split(":")[0];
    const tool = HOST_TO_TOOL[host];

    // Not a tool domain — passthrough
    if (!tool) {
      return passthrough(req, res, bodyBuffer);
    }

    // Forward to our proxy router instead of upstream
    // This lets the proxy handle model routing, RTK, combos, etc.
    return await forwardToRouter(req, res, bodyBuffer, tool);
  } catch (e: any) {
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message, type: "mitm_error" } }));
  }
}

/**
 * Forward intercepted request to the local responses-proxy router.
 * The proxy will handle model selection, provider routing, RTK, etc.
 */
async function forwardToRouter(
  req: IncomingMessage,
  res: ServerResponse,
  bodyBuffer: Buffer,
  tool: string,
) {
  const url = new URL(ROUTER_BASE_URL);
  const http = require("node:http");

  // Rewrite the model in the request body using saved per-tool mappings.
  let outBuffer = bodyBuffer;
  let mappedModel: string | null = null;
  let mappedProviderId: string | null = null;
  try {
    if (bodyBuffer.length > 0) {
      const parsed = JSON.parse(bodyBuffer.toString("utf8"));
      const nativeModel = typeof parsed?.model === "string" ? parsed.model : "";
      if (nativeModel) {
        const routing = resolveModelRouting(tool, nativeModel);
        if (routing && routing.model) {
          let targetModel = routing.model;
          let targetProvider = routing.providerId;

          // Combo mapping: resolve to a concrete { providerId, model } pick
          if (routing.providerId === COMBO_PROVIDER && targetModel) {
            const resolved = await resolveComboPick(targetModel);
            if (resolved) {
              targetModel = resolved.model;
              targetProvider = resolved.providerId;
            }
          }

          if (targetModel && targetModel !== nativeModel) {
            mappedModel = targetModel;
            mappedProviderId = targetProvider;
            parsed.model = targetModel;
            outBuffer = Buffer.from(JSON.stringify(parsed), "utf8");
          }
        }
      }
    }
  } catch {
    // Body not JSON — forward as-is
    outBuffer = bodyBuffer;
  }

  const proxyReq = http.request({
    hostname: url.hostname,
    port: url.port || 8318,
    path: "/v1/chat/completions",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(outBuffer.length),
      [INTERNAL_HEADER]: INTERNAL_VALUE,
      "x-mitm-tool": tool,
      ...(mappedModel ? { "x-mitm-mapped-model": mappedModel } : {}),
      ...(mappedProviderId ? { "x-provider-id": mappedProviderId } : {}),
      "x-mitm-original-host": req.headers.host || "",
      "x-mitm-original-path": req.url || "",
    },
  }, (proxyRes: any) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (e: any) => {
    // If proxy is unreachable, passthrough to real upstream
    passthrough(req, res, bodyBuffer);
  });

  proxyReq.write(outBuffer);
  proxyReq.end();
}

/**
 * Ask the proxy to resolve a model combo into a concrete provider + model.
 * Returns null on any failure (caller falls back to forwarding the combo id).
 */
function resolveComboPick(comboId: string): Promise<{ providerId: string | null; model: string } | null> {
  return new Promise((resolve) => {
    try {
      const url = new URL(ROUTER_BASE_URL);
      const http = require("node:http");
      const reqOpts = {
        hostname: url.hostname,
        port: url.port || 8318,
        path: `/api/model-combos/${encodeURIComponent(comboId)}/resolve`,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "2", [INTERNAL_HEADER]: INTERNAL_VALUE },
      };
      const r = http.request(reqOpts, (resp: any) => {
        let data = "";
        resp.on("data", (c: Buffer) => { data += c; });
        resp.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed?.ok && typeof parsed.model === "string") {
              resolve({ providerId: parsed.providerId ?? null, model: parsed.model });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      r.on("error", () => resolve(null));
      r.write("{}");
      r.end();
    } catch {
      resolve(null);
    }
  });
}

/**
 * Forward request to the real upstream (bypass /etc/hosts via custom DNS).
 */
async function passthrough(req: IncomingMessage, res: ServerResponse, bodyBuffer: Buffer) {
  const originalHost = (req.headers.host || "").split(":")[0];
  const targetIP = await resolveTargetIP(originalHost);

  const forwardReq = https.request({
    hostname: targetIP,
    port: 443,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: originalHost },
    servername: originalHost,
    rejectUnauthorized: false,
  }, (forwardRes) => {
    res.writeHead(forwardRes.statusCode || 502, forwardRes.headers);
    forwardRes.pipe(res);
  });

  forwardReq.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502);
    res.end("Bad Gateway");
  });

  if (bodyBuffer.length > 0) forwardReq.write(bodyBuffer);
  forwardReq.end();
}

// ─── Server startup ──────────────────────────────────────────────────────────

export function startMitmServer(): { pid: number } {
  if (!rootCaExists()) {
    throw new Error("Root CA not found. Generate it first via the dashboard.");
  }

  const rootCA = loadRootCA();
  rootCAPem = rootCA.cert;

  const sslOptions: https.ServerOptions = {
    key: rootCA.key,
    cert: rootCA.cert,
    SNICallback: sniCallback as any,
  };

  // Kill existing process on port 443
  try {
    const pids = execSync(`lsof -nP -iTCP:${LOCAL_PORT} -sTCP:LISTEN -t`, { encoding: "utf8", timeout: 3000 }).trim();
    if (pids) {
      pids.split("\n").forEach((pid) => {
        try { process.kill(Number(pid), "SIGKILL"); } catch { /* ignore */ }
      });
    }
  } catch { /* port is free */ }

  const server = https.createServer(sslOptions, handleRequest);

  server.listen(LOCAL_PORT, () => {
    console.log(`[mitm] 🚀 MITM server running on :${LOCAL_PORT}`);
    writeFileSync(PID_FILE, String(process.pid));
  });

  server.on("error", (e: any) => {
    if (e.code === "EADDRINUSE") {
      throw new Error(`Port ${LOCAL_PORT} already in use`);
    }
    if (e.code === "EACCES") {
      throw new Error(`Permission denied for port ${LOCAL_PORT}. Run with sudo.`);
    }
    throw e;
  });

  // Graceful shutdown
  const shutdown = () => {
    removeAllDNSEntriesSync();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { pid: process.pid };
}

export function getMitmPid(): number | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const pid = Number(readFileSync(PID_FILE, "utf8").trim());
    // Check if process is alive
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

export function isMitmRunning(): boolean {
  return getMitmPid() !== null;
}
