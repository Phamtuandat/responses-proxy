import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { KiroImportError } from "./kiro-import.js";
import { extractEmailFromJWT, importKiroAccountsFromJson } from "./kiro-json-import.js";

const NOW = new Date("2026-07-08T00:00:00.000Z");

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.sig`;
}

function readRows(destPath: string): Array<Record<string, unknown>> {
  const db = new BetterSqlite3(destPath, { readonly: true });
  const rows = db.prepare("SELECT * FROM providerConnections ORDER BY priority").all() as Array<
    Record<string, unknown>
  >;
  db.close();
  return rows;
}

function fakeFetch(accessToken: string, extra: Record<string, unknown> = {}) {
  return (async () =>
    new Response(
      JSON.stringify({ accessToken, refreshToken: "fresh-refresh", expiresIn: 3600, ...extra }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

test("extractEmailFromJWT decodes the email claim", () => {
  const token = makeJwt({ email: "person@example.com", sub: "abc" });
  assert.equal(extractEmailFromJWT(token), "person@example.com");
  assert.equal(extractEmailFromJWT("not-a-jwt"), null);
});

test("imports a social (non-IDC) account and refreshes it", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "nested", "kiro.sqlite");
    const token = makeJwt({ email: "social@example.com" });

    const result = await importKiroAccountsFromJson({
      json: { refreshToken: "aorAAAAAG-social" },
      destDbPath: dest,
      fetchImpl: fakeFetch(token, { profileArn: "arn:profile:1" }),
      now: NOW,
    });

    assert.equal(result.imported, 1);
    assert.equal(result.accounts[0].authMethod, "imported");
    assert.equal(result.accounts[0].email, "social@example.com");
    assert.equal(result.accounts[0].refreshed, true);

    const rows = readRows(dest);
    assert.equal(rows.length, 1);
    const data = JSON.parse(String(rows[0].data));
    assert.equal(data.accessToken, token);
    assert.equal(data.refreshToken, "fresh-refresh");
    assert.equal(data.testStatus, "active");
    assert.equal(data.providerSpecificData.authMethod, "imported");
    assert.equal(data.providerSpecificData.provider, "Imported");
    assert.equal(data.providerSpecificData.profileArn, "arn:profile:1");
    assert.equal(rows[0].email, "social@example.com");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("imports an IDC account with clientId/clientSecret and stores enterprise metadata", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "kiro.sqlite");
    const token = makeJwt({ preferred_username: "idc@corp.com" });

    const result = await importKiroAccountsFromJson({
      json: {
        refreshToken: "refresh-idc",
        clientId: "client-1",
        clientSecret: "secret-1",
        region: "eu-west-1",
      },
      destDbPath: dest,
      fetchImpl: fakeFetch(token),
      now: NOW,
    });

    assert.equal(result.accounts[0].authMethod, "idc");
    const data = JSON.parse(String(readRows(dest)[0].data));
    assert.equal(data.providerSpecificData.authMethod, "idc");
    assert.equal(data.providerSpecificData.provider, "Enterprise");
    assert.equal(data.providerSpecificData.clientId, "client-1");
    assert.equal(data.providerSpecificData.clientSecret, "secret-1");
    assert.equal(data.providerSpecificData.region, "eu-west-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("imports an external_idp account (Microsoft SSO) and parses snake_case properties", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "kiro.sqlite");
    const token = makeJwt({ email: "external@samcvn.cyou" });

    const result = await importKiroAccountsFromJson({
      json: {
        access_token: "old-access",
        auth_method: "external_idp",
        client_id: "client-id-xyz",
        expired: "2026-07-07T19:25:00Z",
        profile_arn: "arn:profile:ext",
        refresh_token: "refresh-token-xyz",
        region: "us-east-1",
        token_endpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
        type: "kiro"
      },
      destDbPath: dest,
      fetchImpl: (async (url: any, init: any) => {
        // Assert that external IDP hits the token endpoint using URLSearchParams
        assert.equal(url, "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token");
        assert.equal(init?.headers?.["Content-Type"], "application/x-www-form-urlencoded");
        const body = new URLSearchParams(init?.body as string);
        assert.equal(body.get("client_id"), "client-id-xyz");
        assert.equal(body.get("grant_type"), "refresh_token");
        assert.equal(body.get("refresh_token"), "refresh-token-xyz");

        return new Response(
          JSON.stringify({
            access_token: token,
            refresh_token: "fresh-refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as unknown as typeof fetch,
      now: NOW,
    });

    assert.equal(result.imported, 1);
    assert.equal(result.accounts[0].authMethod, "external_idp");
    assert.equal(result.accounts[0].email, "external@samcvn.cyou");

    const rows = readRows(dest);
    assert.equal(rows.length, 1);
    const data = JSON.parse(String(rows[0].data));
    assert.equal(data.accessToken, token);
    assert.equal(data.refreshToken, "fresh-refresh-token");
    assert.equal(data.providerSpecificData.authMethod, "external_idp");
    assert.equal(data.providerSpecificData.provider, "External IDP");
    assert.equal(data.providerSpecificData.clientId, "client-id-xyz");
    assert.equal(data.providerSpecificData.tokenEndpoint, "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accepts a 9router backup shape and imports only kiro rows", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "kiro.sqlite");
    const backup = {
      providerConnections: [
        { provider: "codex", refreshToken: "not-kiro" },
        {
          provider: "kiro",
          name: "Account 1",
          refreshToken: "r-a",
          clientId: "c",
          clientSecret: "s",
          providerSpecificData: { profileArn: null },
        },
        { provider: "kiro", name: "Account 2", refreshToken: "r-b" },
      ],
    };

    const result = await importKiroAccountsFromJson({
      json: backup,
      destDbPath: dest,
      fetchImpl: fakeFetch(makeJwt({ sub: "u" })),
      now: NOW,
    });

    assert.equal(result.imported, 2);
    const rows = readRows(dest);
    assert.deepEqual(
      rows.map((r) => r.name),
      ["Account 1", "Account 2"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-import with the same id upserts the existing row (backup restore)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "kiro.sqlite");
    const opts = {
      destDbPath: dest,
      fetchImpl: fakeFetch(makeJwt({ sub: "u" })),
      now: NOW,
    };
    await importKiroAccountsFromJson({ ...opts, json: { id: "acct-1", refreshToken: "t", name: "First" } });
    await importKiroAccountsFromJson({ ...opts, json: { id: "acct-1", refreshToken: "t", name: "Second" } });

    const rows = readRows(dest);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "Second");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-import without an id creates a fresh connection each time (like 9router)", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "kiro.sqlite");
    const opts = {
      json: { refreshToken: "same-token", name: "Same" },
      destDbPath: dest,
      fetchImpl: fakeFetch(makeJwt({ sub: "u" })),
      now: NOW,
    };
    await importKiroAccountsFromJson(opts);
    await importKiroAccountsFromJson(opts);

    assert.equal(readRows(dest).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refresh:false stores tokens verbatim without hitting the network", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "kiro.sqlite");
    const token = makeJwt({ email: "verbatim@example.com" });
    const failFetch = (async () => {
      throw new Error("network should not be called");
    }) as unknown as typeof fetch;

    const result = await importKiroAccountsFromJson({
      json: { refreshToken: "r", accessToken: token, expiresIn: 1200 },
      destDbPath: dest,
      refresh: false,
      fetchImpl: failFetch,
      now: NOW,
    });

    assert.equal(result.accounts[0].refreshed, false);
    const data = JSON.parse(String(readRows(dest)[0].data));
    assert.equal(data.accessToken, token);
    assert.equal(data.refreshToken, "r");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reads JSON from a file path", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    const dest = path.join(dir, "kiro.sqlite");
    const file = path.join(dir, "accounts.json");
    writeFileSync(file, JSON.stringify([{ refreshToken: "r1" }, { refreshToken: "r2" }]));

    const result = await importKiroAccountsFromJson({
      filePath: file,
      destDbPath: dest,
      fetchImpl: fakeFetch(makeJwt({ sub: "u" })),
      now: NOW,
    });

    assert.equal(result.imported, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws when no importable accounts are present", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    await assert.rejects(
      () =>
        importKiroAccountsFromJson({
          json: { providerConnections: [{ provider: "codex", refreshToken: "x" }] },
          destDbPath: path.join(dir, "kiro.sqlite"),
          fetchImpl: fakeFetch(makeJwt({ sub: "u" })),
          now: NOW,
        }),
      (error: unknown) => error instanceof KiroImportError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("throws on invalid JSON text", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-json-"));
  try {
    await assert.rejects(
      () =>
        importKiroAccountsFromJson({
          jsonText: "{ not json",
          destDbPath: path.join(dir, "kiro.sqlite"),
          fetchImpl: fakeFetch(makeJwt({ sub: "u" })),
          now: NOW,
        }),
      (error: unknown) => error instanceof KiroImportError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
