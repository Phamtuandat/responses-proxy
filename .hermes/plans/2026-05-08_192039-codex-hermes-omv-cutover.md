# Plan: đấu Codex + Hermes vào OMV responses-proxy

## Goal
Chuyển cả Codex và Hermes từ Mac sang OMV, dùng OMV `responses-proxy` làm shared gateway. Giữ runtime parity, không làm hỏng quick apply, không phá existing Mac config cho tới khi OMV verify xong.

## Current state
- OMV `responses-proxy` chạy OK trên `http://127.0.0.1:8318`.
- Mac Codex hiện trỏ OMV proxy:
  - `~/.codex/config.toml` base_url = `http://192.168.0.201:8318/v1`
  - `~/.codex/auth.json` vẫn chứa same route key.
- OMV `app_state` already has `client_route_api_keys.codex` mapped.
- `GET /v1/models` on OMV proxy returns `200`.
- Hermes Mac config still points local Mac proxy at `http://127.0.0.1:8318/v1` and has explicit `context_length: 256000`.
- OMV proxy currently bind-mounts host `.hermes`/`.codex` paths via `RESPONSES_PROXY_HOST_HOME`.

## Approach
Use OMV as source of truth for both clients:
- Codex: keep OMV proxy base URL and route key stored in OMV DB; move Mac Codex config to OMV host URL if needed.
- Hermes: point `~/.hermes/config.yaml` to OMV proxy URL and ensure OMV-host config path is mounted and writable.
- Keep `responses-proxy` as single shared provider router; do not bypass it for either client.

## Steps
1. **Inspect Hermes quick-apply path**
   - Confirm OMV mount paths for `~/.hermes/config.yaml` and `~/.codex/` exist.
   - Confirm `/api/client-configs/status` and `/api/client-configs/apply` behavior for `hermes` and `codex` on OMV.
   - Verify whether Hermes config on Mac should keep `context_length` or can rely on OMV client config.

2. **Decide target URLs**
   - Codex target: `https://proxy.taskhub.io.vn/v1` or `http://192.168.0.201:8318/v1`.
   - Hermes target: same OMV proxy URL, likely `https://proxy.taskhub.io.vn/v1` for stable cutover.

3. **Apply Hermes config through proxy**
   - Use `/api/client-configs/apply` for `client=hermes` with selected model and OMV base URL.
   - Ensure generated Hermes config keeps:
     - model
     - provider = `custom`
     - api_key = route API key
     - base_url = OMV proxy URL
     - api_mode = `codex_responses`
   - Preserve `context_length` if the existing Hermes config needs it.

4. **Ensure Codex auth/config parity on OMV**
   - Confirm OMV `/root/.codex/config.toml` and `/root/.codex/auth.json` exist or are created by Quick Apply.
   - Confirm `client_route_api_keys` state still includes `codex` and any Hermes route key if created.
   - Confirm Codex config points at OMV proxy host, not Mac loopback.

5. **Optional cleanup on Mac**
   - If OMV cutover succeeds, remove or downgrade Mac-local dependency on local `responses-proxy` for Codex/Hermes.
   - Leave backups in place.

## Files likely touched
- `src/server.ts` if quick-apply behavior needs adjustment for OMV-host paths or host availability checks.
- `src/client-config-apply.ts` only if Hermes/Codex config generation needs a small path or field fix.
- `docker-compose.yml` / `docker-compose.proxy.yml` only if OMV mount/env parity still missing.
- `.env.production.checklist` only if additional OMV host vars are needed.
- User config files on Mac / OMV:
  - `~/.hermes/config.yaml`
  - `~/.codex/config.toml`
  - `~/.codex/auth.json`

## Verification
- `curl http://127.0.0.1:8318/health` on OMV returns `ok`.
- `curl http://127.0.0.1:8318/v1/models` returns `200`.
- `curl /api/client-configs/status` shows both `hermes` and `codex` configured against OMV proxy.
- Hermes and Codex both can call OMV proxy without local Mac loopback dependency.
- Quick Apply writes backup files before config mutation.

## Risks
- Hermes config may require `context_length`; dropping it could change model behavior.
- OMV path mounts may not match if `RESPONSES_PROXY_HOST_HOME` is wrong.
- If Codex/Hermes configs are switched to public domain too early, DNS/TLS can become new failure point.
- Quick Apply may overwrite existing client-specific fields; backups are mandatory before change.

## Open questions
- Use public `https://proxy.taskhub.io.vn/v1` or LAN `http://192.168.0.201:8318/v1` as final client base URL?
- Should Hermes keep explicit `context_length: 256000` or let proxy-side defaults handle it?
- Do you want Codex and Hermes both on same OMV route key, or separate route keys for isolation?
