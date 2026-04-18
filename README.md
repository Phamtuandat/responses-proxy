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

macOS auto-start at login:

```bash
./scripts/install-launch-agent.sh
```

When the upstream is KRouter, the proxy now performs a preflight usage check
against `https://krouter.net/api/keys/check-usage` with body
`{"apiKey":"..."}` before forwarding `/v1/responses`. If the API key has no
remaining token allowance, the proxy returns `429`.

The proxy also serves a stable `GET /v1/models` response for OpenAI-compatible
clients such as Hermes, so model metadata discovery does not collapse to a
128k fallback whenever the upstream `/v1/models` is unavailable.

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

- proxy upstream: `${ACCSHOP24H_BASE_URL}` + `${ACCSHOP24H_API_KEY}`
- Hermes provider base URL: `${RESPONSES_PROXY_BASE_URL}`
- Codex fallback provider: `model_provider` from `~/.codex/config.toml`

Use:

```bash
export RESPONSES_PROXY_BASE_URL=http://127.0.0.1:8318/v1
```

Then point Hermes at `http://127.0.0.1:8318/v1` and keep the provider wire format on Responses/OpenAI-compatible mode.

## Fallback behavior

By default the proxy reads `~/.codex/config.toml`, finds the active
`model_provider`, and uses it as a fallback only when:

- KRouter preflight rejects the request with `429`
- the primary upstream request fails with `429`, `500`, `502`, `503`, or `504`

Environment variables:

- `FALLBACK_ENABLED=true`
- `FALLBACK_CODEX_CONFIG_PATH=~/.codex/config.toml`
- `FALLBACK_STATUS_CODES=429,500,502,503,504`
- `APP_DB_PATH=./logs/app.sqlite`
- `DEFAULT_MODEL_CONTEXT_LENGTH=256000`
- `MODEL_CONTEXT_LENGTH_MAP=cx/gpt-5.4=1000000,gpt-5.4=1000000,cx/gpt-5.4-xhigh=1000000,gpt-5.4-xhigh=1000000,cx/gpt-5.4-mini=256000,gpt-5.4-mini=256000`

Healthcheck now reports both the primary upstream and the resolved fallback.

## KRouter Token UI

Simple built-in UI:

```bash
open http://127.0.0.1:8318/
```

JSON API:

```bash
curl -X POST http://127.0.0.1:8318/api/krouter/check-token \
  -H 'Content-Type: application/json' \
  -d '{"apiKey":"sk-..."}'
```

## Hermes Token Optimization

The proxy can reduce token burn for Hermes-style requests by:

- forwarding prompt/cache/continuation fields that were previously dropped
- auto-generating a stable `prompt_cache_key` for Hermes when the client does not send one
- defaulting `reasoning.summary` to `auto` when absent
- defaulting `text.verbosity` to `low` when absent
- stripping `max_output_tokens` for KRouter because the current upstream rejects it
- sanitizing unsupported `reasoning.summary=none` to `auto` for KRouter

The environment variable names still use the `OPENCLAW_*` prefix for backward compatibility with existing deployments.

Environment variables:

- `OPENCLAW_TOKEN_OPTIMIZATION_ENABLED=true`
- `OPENCLAW_DEFAULT_REASONING_EFFORT=low`
- `OPENCLAW_DEFAULT_REASONING_SUMMARY=auto`
- `OPENCLAW_DEFAULT_TEXT_VERBOSITY=low`
- `OPENCLAW_DEFAULT_MAX_OUTPUT_TOKENS=...` optional hard cap
- `OPENCLAW_AUTO_PROMPT_CACHE_KEY=true`
- `OPENCLAW_PROMPT_CACHE_RETENTION=24h`
- `OPENCLAW_DEFAULT_TRUNCATION=auto`
- `STRIP_MAX_OUTPUT_TOKENS_FOR_KROUTER=true`
- `SANITIZE_REASONING_SUMMARY_FOR_KROUTER=true`

For cache observability, every proxied response now includes:

- `x-proxy-prompt-cache-key`
- `x-proxy-prompt-cache-retention`

Latest observed cache metadata is also available at:

```bash
curl http://127.0.0.1:8318/api/debug/prompt-cache/latest
```

## Healthcheck

```bash
curl http://127.0.0.1:8318/health
```
