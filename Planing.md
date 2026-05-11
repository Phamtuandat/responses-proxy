# AGENTS.md — responses-proxy: System Summary & Optimization Plan

> **Purpose:** This document is for Codex / AI agents to understand the current architecture and execute prompt cost optimization tasks in priority order.

---

## 1. System Overview

### Stack
- **Runtime:** Node.js ≥ 20.19, TypeScript (ESM), `tsx` for dev
- **Web framework:** Fastify 5
- **Database:** `better-sqlite3` (SQLite) — billing, sessions, prompt-cache state, customer keys
- **Build:** `tsc` (server) + Vite (React dashboard)
- **Test:** `tsx --test` (Node built-in test runner)

### Entry Points
| File | Role |
|---|---|
| `src/server.ts` | Main HTTP server (~4400 lines), contains the full request pipeline |
| `src/config.ts` | Reads env vars via Zod schema, exports `AppConfig` |
| `src/forward.ts` | `forwardJson()` and `forwardSse()` — calls upstream LLM API |
| `src/normalize-request.ts` | Normalizes request, injects prompt-cache headers |
| `src/prompt-cache.ts` | `buildPromptCacheLayout()` — splits stable prefix / dynamic tail |
| `src/prompt-cache-state.ts` | `PromptCacheStateStore` — SQLite, stores cache observations & session streaks |
| `src/rtk-layer.ts` | `applyRtkLayer()` — truncates tool output to reduce tokens |
| `src/client-token-limits.ts` | Per-client token quota enforcement |
| `src/billing.ts` | Plans, subscriptions, entitlements (SQLite) |
| `src/provider-routing.ts` | Selects provider based on API key and headers |
| `src/runtime-provider-repository.ts` | Manages provider presets, client routes, token usage |

### Request Pipeline (summary)
```
HTTP POST /responses
  → Auth (API key → client route → provider)
  → Client token limit check
  → normalizeResponsesRequestWithCache()   ← injects prompt_cache_key, splits stable+dynamic
  → applyRtkLayer()                        ← truncates tool outputs
  → buildInflightDedupeKey()               ← prevents duplicate in-flight requests
  → forwardJson() / forwardSse()           ← calls upstream
  → recordCustomerUsage()
  → return response
```

### Existing Optimization Mechanisms
| Mechanism | File | Enabled by default |
|---|---|---|
| Prompt prefix caching (stable/dynamic split) | `prompt-cache.ts` | `OPENCLAW_AUTO_PROMPT_CACHE_KEY != false` |
| Stable summarization (compress long history) | `prompt-cache.ts` | `PROVIDER_PROMPT_CACHE_STABLE_SUMMARIZATION_ENABLED=true` |
| RTK layer (truncate tool output) | `rtk-layer.ts` | `RTK_LAYER_ENABLED=true` |
| Inflight dedupe (in-memory Map) | `server.ts:2598` | `PROVIDER_PROMPT_CACHE_INFLIGHT_DEDUPE_ENABLED != false` |
| Token optimization (reasoning summary, verbosity) | `server.ts` | `OPENCLAW_TOKEN_OPTIMIZATION_ENABLED != false` |
| Per-client token limits | `client-token-limits.ts` | configured per client |

### Gaps (not yet implemented)
- ❌ **Response-level cache** — no cache stores full responses; every request hits upstream
- ❌ **Semantic/similarity cache** — no embedding-based lookup
- ❌ **Automatic model routing** — no logic to select a cheaper model by complexity
- ❌ **Cost analytics endpoint** — cache savings are logged but no summary API exists

---

## 2. Optimization Tasks

Execute in order: Task 1 → Task 2 → Task 3 → Task 4. Each task is independent and must not break prior tasks.

---

### Task 1 — Response Cache (Exact Match)

**Priority:** HIGH · Estimated savings: 100% cost for repeated identical requests

**Description:**
The existing `inflightJsonRequests` (in-memory Map) only deduplicates requests running concurrently. Add a persistent cache that stores full JSON responses keyed by `requestKey`, with TTL. Only applies to non-streaming (`stream !== true`) requests.

**New file to create:** `src/response-cache.ts`

```typescript
// src/response-cache.ts
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

export type ResponseCacheEntry = {
  requestKey: string;
  providerId: string;
  payload: unknown;
  createdAt: number;
  expiresAt: number;
};

export class ResponseCacheStore {
  private constructor(private readonly db: InstanceType<typeof BetterSqlite3>) {}

  static create(dbFile: string): ResponseCacheStore {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS response_cache (
        request_key TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (request_key, provider_id)
      );
      CREATE INDEX IF NOT EXISTS idx_response_cache_expires
        ON response_cache(expires_at);
    `);
    return new ResponseCacheStore(db);
  }

  get(requestKey: string, providerId: string): unknown | undefined {
    const nowMs = Date.now();
    const row = this.db
      .prepare(
        `SELECT payload FROM response_cache
         WHERE request_key = ? AND provider_id = ? AND expires_at > ?`,
      )
      .get(requestKey, providerId, nowMs) as { payload: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.payload);
    } catch {
      return undefined;
    }
  }

  set(requestKey: string, providerId: string, payload: unknown, ttlMs: number): void {
    const nowMs = Date.now();
    this.db
      .prepare(
        `INSERT INTO response_cache (request_key, provider_id, payload, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(request_key, provider_id) DO UPDATE SET
           payload = excluded.payload,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(requestKey, providerId, JSON.stringify(payload), nowMs, nowMs + ttlMs);
  }

  prune(): number {
    const result = this.db
      .prepare("DELETE FROM response_cache WHERE expires_at <= ?")
      .run(Date.now());
    return result.changes;
  }

  stats(): { totalEntries: number; expiredEntries: number; estimatedBytes: number } {
    const nowMs = Date.now();
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM response_cache").get() as { n: number }).n;
    const expired = (this.db.prepare("SELECT COUNT(*) AS n FROM response_cache WHERE expires_at <= ?").get(nowMs) as { n: number }).n;
    const bytes = (this.db.prepare("SELECT COALESCE(SUM(LENGTH(payload)), 0) AS b FROM response_cache").get() as { b: number }).b;
    return { totalEntries: total, expiredEntries: expired, estimatedBytes: bytes };
  }

  flush(): number {
    return this.db.prepare("DELETE FROM response_cache").run().changes;
  }
}
```

**Changes to `src/config.ts`** — add to `envSchema`:
```typescript
RESPONSE_CACHE_ENABLED: z.string().optional().transform((v) => v === "true"),
RESPONSE_CACHE_TTL_MS: z.coerce.number().int().positive().default(5 * 60 * 1000),
RESPONSE_CACHE_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(512 * 1024),
```

**Changes to `src/server.ts`:**

Step 1 — Import and initialize (after the line `const promptCacheStateStore = ...`):
```typescript
import { ResponseCacheStore } from "./response-cache.js";
const responseCacheStore = ResponseCacheStore.create(path.resolve(config.APP_DB_PATH));
setInterval(() => responseCacheStore.prune(), 10 * 60 * 1000).unref();
```

Step 2 — Cache lookup before calling upstream. Find the line `const dedupeKey = buildInflightDedupeKey(...)` (~line 1735), insert BEFORE it:
```typescript
// Response cache lookup (exact match, non-streaming only)
if (config.RESPONSE_CACHE_ENABLED && traceContext.requestKey && !stream) {
  const cachedPayload = responseCacheStore.get(traceContext.requestKey, activeProviderId);
  if (cachedPayload) {
    logger.info({ requestId, requestKey: traceContext.requestKey }, "response cache hit");
    reply.header("x-proxy-response-cache", "hit");
    return reply.send(cachedPayload);
  }
}
```

Step 3 — Store response after receiving from upstream. Find where `payload` is assigned from `runJsonRequestWithInflightDedupe`, insert AFTER:
```typescript
if (
  config.RESPONSE_CACHE_ENABLED &&
  traceContext.requestKey &&
  !stream &&
  upstreamStatus === 200 &&
  payload !== undefined
) {
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length <= config.RESPONSE_CACHE_MAX_PAYLOAD_BYTES) {
    responseCacheStore.set(
      traceContext.requestKey,
      activeProviderId,
      payload,
      config.RESPONSE_CACHE_TTL_MS,
    );
  }
}
```

**Verification:**
```bash
npm run check
npm test
# Enable with: RESPONSE_CACHE_ENABLED=true
```

---

### Task 2 — Cost Analytics API

**Priority:** MEDIUM · Required to measure ROI of Task 1 and Task 3

**Description:**
Add a `GET /api/analytics/cost-summary` endpoint that aggregates data from prompt-cache observations to give operators visibility into which mechanisms are saving the most.

**New file to create:** `src/cost-analytics.ts`

```typescript
// src/cost-analytics.ts

export type CostSummary = {
  window: { from: string; to: string };
  totalRequests: number;
  promptCacheHits: number;
  promptCacheHitRate: number;      // 0–1
  avgCacheSavedPercent: number;    // 0–100
  estimatedTokensSaved: number;
};

export function buildCostSummary(observations: Array<{
  cacheHit?: boolean;
  cacheSavedPercent?: number;
  cachedTokens?: number;
  timestamp: string;
}>): CostSummary {
  const total = observations.length;
  if (total === 0) {
    const now = new Date().toISOString();
    return {
      window: { from: now, to: now },
      totalRequests: 0,
      promptCacheHits: 0,
      promptCacheHitRate: 0,
      avgCacheSavedPercent: 0,
      estimatedTokensSaved: 0,
    };
  }

  const hits = observations.filter((o) => o.cacheHit === true).length;
  const savedPcts = observations
    .map((o) => o.cacheSavedPercent)
    .filter((v): v is number => typeof v === "number");
  const avgSaved =
    savedPcts.length > 0 ? savedPcts.reduce((a, b) => a + b, 0) / savedPcts.length : 0;
  const tokensSaved = observations.map((o) => o.cachedTokens ?? 0).reduce((a, b) => a + b, 0);
  const timestamps = observations.map((o) => o.timestamp).sort();

  return {
    window: { from: timestamps[0], to: timestamps[timestamps.length - 1] },
    totalRequests: total,
    promptCacheHits: hits,
    promptCacheHitRate: total > 0 ? hits / total : 0,
    avgCacheSavedPercent: avgSaved,
    estimatedTokensSaved: tokensSaved,
  };
}
```

**Add to `src/server.ts`** (alongside existing `app.get("/api/debug/...")` routes):
```typescript
import { buildCostSummary } from "./cost-analytics.js";

app.get("/api/analytics/cost-summary", async (request, reply) => {
  if (!isOperatorRequest(request)) return reply.status(403).send({ error: "forbidden" });

  const { latest, byProvider } = promptCacheStateStore.loadLatestObservations();
  return reply.send({
    latestObservation: latest ?? null,
    byProvider: Object.fromEntries(byProvider),
    responseCacheStats: config.RESPONSE_CACHE_ENABLED ? responseCacheStore.stats() : null,
  });
});

app.post("/api/analytics/response-cache/flush", async (request, reply) => {
  if (!isOperatorRequest(request)) return reply.status(403).send({ error: "forbidden" });
  const deleted = responseCacheStore.flush();
  return reply.send({ deleted });
});
```

---

### Task 3 — Smart Model Routing

**Priority:** MEDIUM · Estimated savings: 20–50% (smaller models are 5–10x cheaper)

**Description:**
Add optional rule-based model routing. If a request meets criteria (low estimated token count, no tools, no images, no reasoning), automatically downgrade to a cheaper model.

**New file to create:** `src/model-routing.ts`

```typescript
// src/model-routing.ts

export type ModelRoutingPolicy = {
  enabled: boolean;
  inputTokenThreshold: number; // downgrade if estimated input tokens < this value
  cheapModel: string;
  skipIfTools: boolean;
  skipIfImages: boolean;
  skipIfReasoning: boolean;
};

export type ModelRoutingDecision =
  | { downgraded: true; originalModel: string; resolvedModel: string; reason: string }
  | { downgraded: false };

export function resolveModelRouting(
  requestBody: Record<string, unknown>,
  policy: ModelRoutingPolicy,
): ModelRoutingDecision {
  if (!policy.enabled) return { downgraded: false };

  const model = typeof requestBody.model === "string" ? requestBody.model : "";
  const isExpensiveModel = /gpt-4|o1|o3|claude-3-5|claude-opus/i.test(model);
  if (!isExpensiveModel) return { downgraded: false };

  if (policy.skipIfTools && Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
    return { downgraded: false };
  }

  if (policy.skipIfReasoning && requestBody.reasoning !== undefined) {
    return { downgraded: false };
  }

  if (policy.skipIfImages) {
    const input = Array.isArray(requestBody.input) ? requestBody.input : [];
    const hasImage = input.some((item) => {
      if (typeof item !== "object" || item === null) return false;
      const content = (item as Record<string, unknown>).content;
      if (!Array.isArray(content)) return false;
      return content.some(
        (c) =>
          typeof c === "object" &&
          c !== null &&
          (c as Record<string, unknown>).type === "image_url",
      );
    });
    if (hasImage) return { downgraded: false };
  }

  const estimatedTokens = estimateInputTokens(requestBody);
  if (estimatedTokens > policy.inputTokenThreshold) {
    return { downgraded: false };
  }

  return {
    downgraded: true,
    originalModel: model,
    resolvedModel: policy.cheapModel,
    reason: `estimated_tokens:${estimatedTokens}<threshold:${policy.inputTokenThreshold}`,
  };
}

function estimateInputTokens(body: Record<string, unknown>): number {
  const instructions = typeof body.instructions === "string" ? body.instructions : "";
  const input = Array.isArray(body.input) ? body.input : [];
  const inputText = input
    .map((item) => {
      if (typeof item !== "object" || item === null) return "";
      const content = (item as Record<string, unknown>).content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((c) =>
            typeof c === "object" && c !== null
              ? String((c as Record<string, unknown>).text ?? "")
              : "",
          )
          .join(" ");
      }
      return "";
    })
    .join(" ");
  // Rough heuristic: 4 chars ≈ 1 token
  return Math.ceil((instructions.length + inputText.length) / 4);
}
```

**Add to `src/config.ts`:**
```typescript
MODEL_ROUTING_ENABLED: z.string().optional().transform((v) => v === "true"),
MODEL_ROUTING_CHEAP_MODEL: z.string().optional().default("gpt-4o-mini"),
MODEL_ROUTING_INPUT_TOKEN_THRESHOLD: z.coerce.number().int().positive().default(2000),
MODEL_ROUTING_SKIP_IF_TOOLS: z.string().optional().transform((v) => v !== "false"),
MODEL_ROUTING_SKIP_IF_IMAGES: z.string().optional().transform((v) => v !== "false"),
MODEL_ROUTING_SKIP_IF_REASONING: z.string().optional().transform((v) => v !== "false"),
```

**Add to `src/server.ts`** — after normalize request step, BEFORE calling forward:
```typescript
import { resolveModelRouting } from "./model-routing.js";

const modelRoutingDecision = resolveModelRouting(
  effectiveRequestBody as Record<string, unknown>,
  {
    enabled: config.MODEL_ROUTING_ENABLED ?? false,
    inputTokenThreshold: config.MODEL_ROUTING_INPUT_TOKEN_THRESHOLD,
    cheapModel: config.MODEL_ROUTING_CHEAP_MODEL ?? "gpt-4o-mini",
    skipIfTools: config.MODEL_ROUTING_SKIP_IF_TOOLS,
    skipIfImages: config.MODEL_ROUTING_SKIP_IF_IMAGES,
    skipIfReasoning: config.MODEL_ROUTING_SKIP_IF_REASONING,
  },
);

if (modelRoutingDecision.downgraded) {
  effectiveRequestBody = {
    ...effectiveRequestBody,
    model: modelRoutingDecision.resolvedModel,
  };
  logger.info({ requestId, ...modelRoutingDecision }, "model downgraded by routing policy");
  reply.header("x-proxy-model-routing", modelRoutingDecision.resolvedModel);
}
```

---

## 3. Environment Variables Reference

Add to `.env` after completing the tasks:

```bash
# Task 1 — Response cache
RESPONSE_CACHE_ENABLED=true
RESPONSE_CACHE_TTL_MS=300000            # 5 minutes
RESPONSE_CACHE_MAX_PAYLOAD_BYTES=524288 # 512 KB

# Task 3 — Model routing
MODEL_ROUTING_ENABLED=true
MODEL_ROUTING_CHEAP_MODEL=gpt-4o-mini
MODEL_ROUTING_INPUT_TOKEN_THRESHOLD=2000
MODEL_ROUTING_SKIP_IF_TOOLS=true
MODEL_ROUTING_SKIP_IF_IMAGES=true
MODEL_ROUTING_SKIP_IF_REASONING=true

# Already available — enable if not already set
PROVIDER_PROMPT_CACHE_REDESIGN_ENABLED=true
PROVIDER_PROMPT_CACHE_STABLE_SUMMARIZATION_ENABLED=true
RTK_LAYER_ENABLED=true
RTK_LAYER_TOOL_OUTPUT_ENABLED=true
OPENCLAW_TOKEN_OPTIMIZATION_ENABLED=true
PROVIDER_PROMPT_CACHE_INFLIGHT_DEDUPE_ENABLED=true
```

---

## 4. Test Commands

```bash
# Type check
npm run check

# Run all tests
npm test

# Run a specific test file
tsx --test src/prompt-cache.test.ts

# Production build
npm run build

# Dev mode
npm run dev
```

---

## 5. Constraints & Notes for Codex

- **Do not use `require()`** — the project is ESM (`"type": "module"`); use `import` with `.js` extensions
- **SQLite calls are synchronous** — `better-sqlite3` uses a sync API; do not use `await` on db calls
- **`src/server.ts` is very large (~4400 lines)** — use search/grep to find insertion points; do not rewrite the whole file
- **Test runner is Node built-in** — use `import { test, describe } from "node:test"` and `import { strictEqual } from "node:assert"`; there is no jest, mocha, or vitest for server tests (Vite is client-only)
- **`traceContext.requestKey`** is the hook point for the response cache — it is a SHA256 hash of the full request (model + instructions + tools + input), already available after `normalizeResponsesRequestWithCache()`
- **Non-streaming only for response cache** — SSE streaming (`stream: true`) cannot be cached; always check `const stream = requestBody.stream === true` before reading or writing the cache
- **All SQLite stores share `APP_DB_PATH`** — `ResponseCacheStore` can use the same file as `PromptCacheStateStore`, or a separate file if preferred
- **`x-proxy-response-cache: hit`** header signals a cache hit to the client — useful for observability and testing
