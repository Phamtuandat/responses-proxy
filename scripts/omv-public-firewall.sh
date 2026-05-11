#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-status}"
TABLE="responses_proxy_public_guard"
ADMIN_LAN_CIDR="${ADMIN_LAN_CIDR:-192.168.0.0/24}"
ROLLBACK_FILE="/root/responses-proxy-firewall-rollback.sh"
BACKUP_FILE="/root/responses-proxy-firewall-backup.nft"

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root on OMV."
    exit 1
  fi
}

require_nft() {
  if ! command -v nft >/dev/null 2>&1; then
    echo "nft is required."
    exit 1
  fi
}

write_rollback() {
  nft list ruleset > "$BACKUP_FILE"
  cat > "$ROLLBACK_FILE" <<EOF
#!/usr/bin/env bash
set -euo pipefail
nft -f "$BACKUP_FILE"
EOF
  chmod 700 "$ROLLBACK_FILE"
}

schedule_rollback() {
  if command -v systemd-run >/dev/null 2>&1; then
    systemd-run --unit responses-proxy-firewall-rollback --on-active=90 "$ROLLBACK_FILE" >/dev/null
    echo "Rollback scheduled in 90 seconds: systemctl cancel responses-proxy-firewall-rollback"
  else
    echo "systemd-run unavailable; rollback file: $ROLLBACK_FILE"
  fi
}

cancel_rollback() {
  systemctl cancel responses-proxy-firewall-rollback 2>/dev/null || true
}

apply_rules() {
  write_rollback
  schedule_rollback
  nft "add table inet $TABLE" 2>/dev/null || true
  nft "flush table inet $TABLE"
  nft "add chain inet $TABLE input { type filter hook input priority -50; policy accept; }"
  nft "add rule inet $TABLE input iifname lo accept"
  nft "add rule inet $TABLE input ct state established,related accept"
  nft "add rule inet $TABLE input iifname tailscale0 accept"
  nft "add rule inet $TABLE input udp dport 41641 accept"
  nft "add rule inet $TABLE input ip saddr $ADMIN_LAN_CIDR tcp dport 22 accept"
  nft "add rule inet $TABLE input tcp dport { 8318, 8080, 111, 5355 } drop"
  nft "add rule inet $TABLE input udp dport { 111, 5353, 5355 } drop"
  echo "Guard firewall rules applied. Verify SSH/Tailscale/proxy, then run:"
  echo "  systemctl cancel responses-proxy-firewall-rollback"
}

case "$MODE" in
  apply)
    require_root
    require_nft
    apply_rules
    ;;
  rollback)
    require_root
    require_nft
    "$ROLLBACK_FILE"
    ;;
  confirm)
    require_root
    cancel_rollback
    echo "Firewall rollback cancelled."
    ;;
  status)
    require_nft
    nft "list table inet $TABLE" 2>/dev/null || echo "No $TABLE firewall table."
    ;;
  *)
    echo "Usage: $0 [status|apply|confirm|rollback]"
    exit 1
    ;;
esac
