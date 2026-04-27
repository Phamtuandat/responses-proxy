# Responses Proxy

Minimal Fastify proxy for a Responses API upstream.

## App Install

Turn this repo into a local app with one command:

```bash
npm run app:install
```

Then open:

```bash
npm run app:open
```

App management:

```bash
npm run app:start
npm run app:stop
npm run app:status
npm run app:logs
```

Tailscale exposure on macOS host:

```bash
npm run tailnet:serve
npm run tailnet:funnel
npm run tailnet:status
npm run tailnet:reset
```

`tailnet:serve` exposes `responses-proxy` only inside your tailnet.

`tailnet:funnel` makes the same local port public on the internet through
Tailscale Funnel.

macOS auto-start at login:

```bash
./scripts/install-launch-agent.sh
```

When the selected provider supports it, the proxy can perform a preflight
usage check before forwarding `/v1/responses`. If the API key has no remaining
allowance, the proxy returns `429`.

`GET /v1/models` is forwarded through to the selected upstream provider, so
model metadata stays owned by the real provider rather than being synthesized
by the proxy.

## Provider Routing With Shared Client Keys

One client API key can be assigned to more than one provider.

Routing order for `/v1/responses` is:

- if `metadata.provider_id` or `x-provider-id` is present, the proxy uses that provider
- else if `metadata.provider`, `metadata.provider_name`, or `x-provider-name` is present, the proxy matches by provider name
- else if the key matches exactly one provider, the proxy uses that provider
- else the proxy returns `409 AMBIGUOUS_PROVIDER_SELECTION`

Model aliasing:

- provider selection does not depend on the `model` prefix
- each provider may define `modelAliases` to rewrite a client-facing alias into the real upstream model name
- alias rewriting only happens after the provider has already been selected
- a provider hint that is not allowed for the current API key returns `403 PROVIDER_NOT_ALLOWED_FOR_API_KEY`

If the primary upstream fails with a retryable status, the proxy can
automatically fall back to the active Codex provider declared in
`~/.codex/config.toml`. In the current setup that means `cliproxy`.

## Supported request fields

- `messages` adapter mode for OpenAI chat-style payloads
- `model`
- `input`
- `instructions`
- `store` (`false` only)
- `stream`
- `tools`
- `tool_choice`
- `parallel_tool_calls`
- `reasoning`
- `text`

The proxy drops unsupported legacy fields by using a strict schema.

## Adapter mode

If the client sends `messages` instead of `input`, the proxy converts them to
Responses API format automatically:

- `system` and `developer` messages are merged into `instructions`
- `user` and `assistant` messages become Responses `input`
- `assistant.tool_calls[]` become `function_call` items
- `tool` messages with `tool_call_id` become `function_call_output` items

If both `input` and `messages` are present, `input` wins.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

## Build

```bash
npm run build
npm start
```

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Current Hermes Wiring

This repo is prepared for a local Hermes setup that should call this proxy instead of the upstream directly:

- proxy upstream: `${UPSTREAM_BASE_URL}` + `${UPSTREAM_API_KEY}`
- Hermes provider base URL: `${RESPONSES_PROXY_BASE_URL}`
- Codex fallback provider: `model_provider` from `~/.codex/config.toml`

Use:

```bash
export RESPONSES_PROXY_BASE_URL=http://127.0.0.1:8318/v1
```

Then point Hermes at `http://127.0.0.1:8318/v1` and keep the provider wire format on Responses/OpenAI-compatible mode.

The dashboard now includes a Quick Apply panel for both Hermes and Codex:

- it points the client to `http://127.0.0.1:8318/v1`
- it ensures the client has a dedicated route API key
- it lets you enter an optional model before patching
- it writes a timestamped backup beside the original config before every patch

Current config files:

- Hermes: `~/.hermes/config.yaml`
- Codex: `~/.codex/config.toml`

## Fallback behavior

By default the proxy reads `~/.codex/config.toml`, finds the active
`model_provider`, and uses it as a fallback only when:

- provider preflight rejects the request with `429`
- the primary upstream request fails with `429`, `500`, `502`, `503`, or `504`

Environment variables:

- `FALLBACK_ENABLED=true`
- `FALLBACK_CODEX_CONFIG_PATH=~/.codex/config.toml`
- `FALLBACK_STATUS_CODES=429,500,502,503,504`
- `APP_DB_PATH=./logs/app.sqlite`

Healthcheck now reports both the primary upstream and the resolved fallback.

## Provider Usage UI

Simple built-in UI:

```bash
open http://127.0.0.1:8318/
```

JSON API:

```bash
curl -X POST http://127.0.0.1:8318/api/providers/check-usage \
  -H 'Content-Type: application/json' \
  -d '{"apiKey":"sk-..."}'
```

## Hermes Token Optimization

The proxy can reduce token burn for Hermes-style requests by:

- forwarding prompt/cache/continuation fields that were previously dropped
- optionally applying an RTK-style request transform layer that canonicalizes and truncates oversized tool output before prompt construction
- auto-generating a stable `prompt_cache_key` for Hermes when the client does not send one
- optionally redesigning cache keys into `family_id`, `static_key`, and `request_key`
- splitting request construction into a reusable `stable_prefix` and a `dynamic_tail`
- optionally replacing older chat history with a deterministic stable summary block
- optionally deduping identical inflight JSON requests so only one upstream request reaches the provider
- defaulting `reasoning.summary` to `auto` when absent
- defaulting `text.verbosity` to `low` when absent
- applying provider-specific request transforms through capability rules when needed

The environment variable names still use the `OPENCLAW_*` prefix for backward compatibility with existing deployments.

Environment variables:

- `OPENCLAW_TOKEN_OPTIMIZATION_ENABLED=true`
- `OPENCLAW_DEFAULT_REASONING_EFFORT=low`
- `OPENCLAW_DEFAULT_REASONING_SUMMARY=auto`
- `OPENCLAW_DEFAULT_TEXT_VERBOSITY=low`
- `OPENCLAW_DEFAULT_MAX_OUTPUT_TOKENS=...` optional hard cap
- `OPENCLAW_AUTO_PROMPT_CACHE_KEY=true`
- `OPENCLAW_PROMPT_CACHE_RETENTION=24h`
- `PROVIDER_PROMPT_CACHE_REDESIGN_ENABLED=false`
- `PROVIDER_PROMPT_CACHE_STABLE_SUMMARIZATION_ENABLED=false`
- `PROVIDER_PROMPT_CACHE_INFLIGHT_DEDUPE_ENABLED=true`
- `PROVIDER_PROMPT_CACHE_RETENTION_BY_FAMILY_ENABLED=false`
- `PROVIDER_PROMPT_CACHE_SUMMARY_TRIGGER_ITEMS=14`
- `PROVIDER_PROMPT_CACHE_SUMMARY_KEEP_RECENT_ITEMS=6`
- `PROVIDER_PROMPT_CACHE_RETENTION_BY_FAMILY=family-prefix=72h,...`
- `RTK_LAYER_ENABLED=false`
- `RTK_LAYER_TOOL_OUTPUT_ENABLED=true`
- `RTK_LAYER_TOOL_OUTPUT_MAX_CHARS=4000`
- `RTK_LAYER_TOOL_OUTPUT_MAX_LINES=120`
- `RTK_LAYER_TOOL_OUTPUT_TAIL_LINES=0`
- `RTK_LAYER_TOOL_OUTPUT_TAIL_CHARS=0`
- `RTK_LAYER_TOOL_OUTPUT_DETECT_FORMAT=auto`
- `OPENCLAW_DEFAULT_TRUNCATION=auto`
- `MAX_OUTPUT_TOKENS_PARAMETER_MODE_FOR_PROVIDER=forward|strip|rename`
- `MAX_OUTPUT_TOKENS_PARAMETER_TARGET_FOR_PROVIDER=max_completion_tokens`
- `STRIP_MAX_OUTPUT_TOKENS_FOR_PROVIDER=false`
- `SANITIZE_REASONING_SUMMARY_FOR_PROVIDER=false`

`STRIP_MAX_OUTPUT_TOKENS_FOR_PROVIDER` is kept for backward compatibility. Prefer the generic
parameter policy variables above for new setups.

For KRouter specifically:

- use `UPSTREAM_BASE_URL=https://krouter.net/v1`
- set `MAX_OUTPUT_TOKENS_PARAMETER_MODE_FOR_PROVIDER=strip` because
  `krouter.net/v1/responses` rejects `max_output_tokens`

For cache observability, every proxied response now includes:

- `x-proxy-family-id`
- `x-proxy-static-key`
- `x-proxy-request-key`
- `x-proxy-prompt-cache-key`
- `x-proxy-prompt-cache-retention`
- `x-proxy-rtk-applied`
- `x-proxy-rtk-chars-saved`

## Error handling

Proxy errors stay backward compatible with the existing shape:

```json
{
  "error": {
    "type": "proxy_error",
    "code": "UPSTREAM_BAD_REQUEST",
    "message": "[req_123] upstream rejected request (429 Too Many Requests): Rate limit reached",
    "request_id": "req_123",
    "upstream_status": 429,
    "upstream_body": "{\"error\":{\"message\":\"Rate limit reached\"}}",
    "upstream_error": {
      "message": "Rate limit reached",
      "type": "rate_limit_error",
      "code": "rate_limit"
    },
    "retryable": true
  }
}
```

Notes:

- `upstream_body` is still returned for compatibility, but is now trimmed when extremely large
- `upstream_error` is extracted when the upstream body is JSON and contains structured error fields
- `retryable=true` is set for `408`, `409`, `429`, and all `5xx` statuses
- stream-mode failures and normal JSON failures now use the same error envelope
- error responses also include `x-proxy-error-code` and `x-proxy-retryable` headers for quick debugging
- providers can define `capabilities.errorPolicy.rules[]` to remap verbose upstream failures into cleaner proxy error codes/messages

The RTK-style layer is intentionally narrow in this repo:

- it only rewrites `tool` / `function_call_output` content
- it strips ANSI noise, normalizes line endings, removes repeated adjacent lines, and clips oversized outputs deterministically
- it can detect `json`, `stack`, and `command` output and truncate with different markers/budgets
- it does not rewrite user intent, provider routing, or upstream responses
- it is feature-flagged so existing deployments remain backward compatible

RTK policy can now be resolved on two levels:

- provider default via `capabilities.rtkPolicy`
- client route override via `POST /api/rtk-policies`
- optional `tailLines` keeps ending log/error lines when truncation happens
- optional `tailChars` reserves character budget for the output tail
- optional `detectFormat` can be `auto`, `plain`, `json`, `stack`, or `command`

Resolution order is:

1. environment defaults
2. provider RTK policy
3. client route RTK policy

This makes it possible to run different RTK intensity for routes such as Hermes vs Codex while still sharing the same upstream provider.

Example:

```bash
curl -X POST http://127.0.0.1:8318/api/rtk-policies \
  -H 'Content-Type: application/json' \
  -d '{
    "client": "hermes",
    "policy": {
      "enabled": true,
      "toolOutputEnabled": true,
      "maxChars": 1200,
      "maxLines": 40,
      "tailLines": 8,
      "tailChars": 400,
      "detectFormat": "command"
    }
  }'
```

The dashboard now exposes separate RTK stats alongside cache stats so operators can distinguish:

- prompt reduction before request construction
- upstream provider-side prompt cache reuse after request construction

Latest observed cache metadata is also available at:

```bash
curl http://127.0.0.1:8318/api/debug/prompt-cache/latest
```

Aggregated cache stats are available at:

```bash
curl http://127.0.0.1:8318/api/stats/usage
```

The stats payload now includes:

- overall daily and monthly totals
- measured cache hit-rate fields that only count requests where upstream returned cache telemetry
- `unknownTelemetryRequests` and `telemetryCoverage` so operators can distinguish real misses from requests with no `cached_tokens` signal
- `byProvider` for per-provider/API efficiency
- `byFamily` for request-family fragmentation and reuse
- `byStaticKey` for reusable prefix hotspots
- `byModel` for model-level cache efficiency
- `topUncachedFamilies` to identify the worst fragmentation first

## Cache Persistence Across Restart

This proxy does not implement a semantic cache or local response replay cache.
Prompt-cache reuse is owned by the upstream provider.

To preserve provider-side prompt cache reuse across rebuild/restart, the important
conditions are:

- the proxy keeps generating the same canonical `prompt_cache_key` / `request_key`
- the upstream provider retention window has not expired
- local runtime state lives on persistent storage

Local persistence now uses two paths:

- `APP_DB_PATH` stores the latest prompt-cache observation and session cache-hit streak state
- `SESSION_LOG_DIR` stores request/session logs used for cache stats and startup hydration fallback

With the default Docker setup, both live under `/app/logs` and should be backed by
a host bind mount or persistent volume. Rebuilding the image does not clear upstream
prompt cache, and restarting the container does not clear the local cache metadata
as long as the mounted `logs/` path is preserved.

What is intentionally not persisted:

- inflight dedupe state for concurrent identical requests
- any local response body replay cache

## Healthcheck

```bash
curl http://127.0.0.1:8318/health
```
