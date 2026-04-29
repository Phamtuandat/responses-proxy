import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const distClientIndexPath = path.join(repoRoot, "dist", "client", "index.html");
const distClientIndexHtml = readFileSync(distClientIndexPath, "utf8");
const builtReactAssetPath = extractBuiltReactAssetPath(distClientIndexHtml);
type ServerChildProcess = ReturnType<typeof spawn>;

test("dashboard serving smoke coverage", { concurrency: false }, async (t) => {
  await t.test("react mode serves dashboard, preserves backend routes, and logs mode", async () => {
    const server = await startDashboardServer();
    try {
      assert.match(
        server.output,
        /Dashboard UI: react \(serving .*dist\/client, legacy fallback at \/legacy\)/,
      );

      const root = await fetchText(`${server.baseUrl}/`);
      assert.equal(root.response.status, 200);
      assert.equal(root.response.headers.get("cache-control"), "no-cache");
      assert.match(root.text, /Responses Proxy React Shell|<div id="root"><\/div>/);

      const legacy = await fetchText(`${server.baseUrl}/legacy`);
      assert.equal(legacy.response.status, 200);
      assert.equal(legacy.response.headers.get("cache-control"), "no-cache");
      assert.match(legacy.text, /Responses Proxy Monitor/);

      const health = await fetchJson(`${server.baseUrl}/health`);
      assert.equal(health.response.status, 200);
      assert.match(health.response.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(health.body.ok, true);

      const providers = await fetchJson(`${server.baseUrl}/api/providers`);
      assert.equal(providers.response.status, 200);
      assert.match(providers.response.headers.get("content-type") ?? "", /application\/json/);
      assert.equal(typeof providers.body, "object");
      assert.doesNotMatch(JSON.stringify(providers.body), /Responses Proxy React Shell/);

      const authCallback = await fetchText(`${server.baseUrl}/auth/chatgpt/callback`);
      assert.notEqual(authCallback.response.status, 404);
      assert.doesNotMatch(authCallback.text, /Responses Proxy React Shell/);
      assert.match(authCallback.text, /ChatGPT OAuth/);

      const v1Models = await fetchText(`${server.baseUrl}/v1/models`);
      assert.notEqual(v1Models.response.status, 200);
      assert.doesNotMatch(v1Models.text, /Responses Proxy React Shell/);
      assert.match(v1Models.response.headers.get("content-type") ?? "", /application\/json/);
    } finally {
      await server.stop();
    }
  });

  await t.test("legacy mode keeps rollback behavior and startup visibility", async () => {
    const server = await startDashboardServer({ DASHBOARD_UI: "legacy" });
    try {
      assert.match(
        server.output,
        /Dashboard UI: legacy \(serving public\/, fallback also available at \/legacy\)/,
      );

      const root = await fetchText(`${server.baseUrl}/`);
      assert.equal(root.response.status, 200);
      assert.equal(root.response.headers.get("cache-control"), "no-cache");
      assert.match(root.text, /Responses Proxy Monitor/);

      const appJs = await fetchText(`${server.baseUrl}/app.js`);
      assert.equal(appJs.response.status, 200);
      assert.equal(appJs.response.headers.get("cache-control"), "no-cache");
      assert.match(appJs.response.headers.get("content-type") ?? "", /javascript/);
      assert.match(appJs.text, /const ROUTES =/);

      const appCss = await fetchText(`${server.baseUrl}/app.css`);
      assert.equal(appCss.response.status, 200);
      assert.equal(appCss.response.headers.get("cache-control"), "no-cache");
      assert.match(appCss.response.headers.get("content-type") ?? "", /text\/css/);
      assert.match(appCss.text, /:root/);

      const legacy = await fetchText(`${server.baseUrl}/legacy`);
      assert.equal(legacy.response.status, 200);
      assert.match(legacy.text, /Responses Proxy Monitor/);

      const health = await fetchJson(`${server.baseUrl}/health`);
      assert.equal(health.response.status, 200);
      assert.equal(health.body.ok, true);
    } finally {
      await server.stop();
    }
  });

  await t.test("static assets use expected cache policy and block traversal", async () => {
    const server = await startDashboardServer();
    try {
      const reactAsset = await fetchText(`${server.baseUrl}${builtReactAssetPath}`);
      assert.equal(reactAsset.response.status, 200);
      assert.equal(
        reactAsset.response.headers.get("cache-control"),
        "public, max-age=31536000, immutable",
      );
      assert.match(reactAsset.response.headers.get("content-type") ?? "", /javascript|text\/css/);

      const legacyAsset = await fetchText(`${server.baseUrl}/legacy/app.js`);
      assert.equal(legacyAsset.response.status, 200);
      assert.equal(legacyAsset.response.headers.get("cache-control"), "no-cache");

      const traversal = await fetchText(`${server.baseUrl}/assets/..%2F..%2Fserver.js`);
      assert.equal(traversal.response.status, 404);
      assert.match(traversal.response.headers.get("content-type") ?? "", /application\/json/);
    } finally {
      await server.stop();
    }
  });
});

function extractBuiltReactAssetPath(indexHtml: string): string {
  const match = indexHtml.match(/"(\/assets\/[^"]+\.(?:js|css))"/);
  assert.ok(match?.[1], "Could not find built React asset reference in dist/client/index.html");
  return match[1];
}

async function fetchText(url: string) {
  const response = await fetch(url);
  const text = await response.text();
  return { response, text };
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  const body = (await response.json()) as Record<string, unknown>;
  return { response, body };
}

async function startDashboardServer(extraEnv: Record<string, string> = {}) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-dashboard-serving-"));
  const port = await getFreePort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "src/server.ts"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        UPSTREAM_BASE_URL: "https://api.openai.com",
        APP_DB_PATH: path.join(tempDir, "app.sqlite"),
        CUSTOMER_KEY_DB_PATH: path.join(tempDir, "customer.sqlite"),
        SESSION_LOG_DIR: path.join(tempDir, "sessions"),
        PROVIDER_USAGE_CHECK_ENABLED: "false",
        CHATGPT_OAUTH_ENABLED: "false",
        LOG_LEVEL: "info",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}/health`, child);
  } catch (error) {
    child.kill("SIGTERM");
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Server failed to start.\n${output}\n${String(error)}`);
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    get output() {
      return output;
    },
    async stop() {
      await stopChild(child);
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

async function waitForServer(url: string, child: ServerChildProcess, timeoutMs = 15_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the timeout expires.
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`server did not become ready within ${timeoutMs}ms`);
}

async function stopChild(child: ServerChildProcess) {
  if (child.exitCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }, 3_000);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not resolve a free port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}
