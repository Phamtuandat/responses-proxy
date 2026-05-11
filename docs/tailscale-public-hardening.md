# Tailscale Funnel public hardening

Use Tailscale Funnel as the only public internet edge for responses-proxy.
Do not expose Docker port `8318` directly through router port forwarding.

## Required shape

```text
Internet -> Tailscale Funnel HTTPS -> http://127.0.0.1:8318 on OMV -> responses-proxy
```

The compose files bind `responses-proxy` to `127.0.0.1:8318` by default via
`RESPONSES_PROXY_PORT_BIND`. Keep that default for production.

## OMV checklist

1. Confirm local proxy is healthy:

   ```bash
   curl -fsS http://127.0.0.1:8318/health
   ```

2. Confirm port `8318` is not bound to all interfaces:

   ```bash
   ss -lntup | grep 8318
   ```

   Expected bind is `127.0.0.1:8318`, not `0.0.0.0:8318`.

3. Enable Tailscale Funnel:

   ```bash
   TAILSCALE_FUNNEL_HTTPS_PORT=443 npm run tailnet:funnel
   ```

   Or directly:

   ```bash
   TAILSCALE_FUNNEL_HTTPS_PORT=443 TAILSCALE_LOCAL_TARGET=http://127.0.0.1:8318 ./scripts/tailnet-funnel.sh
   ```

4. Verify:

   ```bash
   tailscale funnel status
   curl -fsS https://<omv>.<tailnet>.ts.net/health
   ```

5. Apply the OMV guard firewall only from an active SSH session:

   ```bash
   sudo ADMIN_LAN_CIDR=192.168.0.0/24 ./scripts/omv-public-firewall.sh apply
   curl -fsS http://127.0.0.1:8318/health
   sudo ./scripts/omv-public-firewall.sh confirm
   ```

   The script schedules a rollback before changing rules. If access breaks,
   wait for rollback or run:

   ```bash
   sudo ./scripts/omv-public-firewall.sh rollback
   ```

## Tailnet policy

Limit Funnel permission to the OMV node, ideally by tag:

```json
{
  "nodeAttrs": [
    {
      "target": ["tag:responses-proxy"],
      "attr": ["funnel"]
    }
  ]
}
```

Do not grant Funnel globally to every user/device.

## App limits

The app has HTTP rate limit knobs:

```bash
HTTP_RATE_LIMIT_ENABLED=true
HTTP_RATE_LIMIT_WINDOW_MS=60000
HTTP_RATE_LIMIT_RESPONSES_MAX_REQUESTS=120
HTTP_RATE_LIMIT_UNAUTHENTICATED_MAX_REQUESTS=20
HTTP_RATE_LIMIT_AUTH_MAX_REQUESTS=30
HTTP_RATE_LIMIT_WEBHOOK_MAX_REQUESTS=60
HTTP_RATE_LIMIT_HEALTH_MAX_REQUESTS=240
```

These limits reduce app-layer abuse but are not a volumetric DDoS shield. For
large attacks, keep the service behind Tailscale Funnel and avoid raw WAN port
forwarding.

Default public body limit is `2097152` bytes in compose/env profiles.
Keep `HTTP_TRUST_PROXY=false` unless a trusted edge proxy overwrites forwarded
headers. Docker-to-Docker calls still use `http://responses-proxy:8318`.
