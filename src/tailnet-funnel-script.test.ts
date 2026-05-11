import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const scriptPath = path.resolve(process.cwd(), "scripts", "tailnet-funnel.sh");
const zshLookup = spawnSync("sh", ["-c", "command -v zsh"], {
  encoding: "utf8",
});
const zshPath = zshLookup.status === 0 ? zshLookup.stdout.trim() : "";

test("tailnet funnel script rejects invalid public https port", { skip: !zshPath }, () => {
  const result = spawnSync(zshPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      TAILSCALE_LOCAL_TARGET: "http://127.0.0.1:8318",
      TAILSCALE_FUNNEL_HTTPS_PORT: "8444",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /TAILSCALE_FUNNEL_HTTPS_PORT/);
});

test("tailnet funnel script rejects non-localhost target", { skip: !zshPath }, () => {
  const result = spawnSync(zshPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      TAILSCALE_LOCAL_TARGET: "http://192.168.0.10:8318",
      TAILSCALE_FUNNEL_HTTPS_PORT: "443",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /TAILSCALE_LOCAL_TARGET must point at localhost/);
});
