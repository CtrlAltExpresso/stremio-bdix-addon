#!/usr/bin/env bash
# Start the addon (if needed), expose it over public HTTPS with a Cloudflare
# quick tunnel, and print the link that opens Stremio and asks to install.
set -euo pipefail

PORT="${PORT:-7000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

info() { printf '\033[1;36m%s\033[0m\n' "$*"; }

if ! curl -fsS "http://127.0.0.1:${PORT}/manifest.json" >/dev/null 2>&1; then
    info "Addon is not running on port ${PORT}. Starting it..."
    nohup npm start >/tmp/stremio-bdix-addon.log 2>&1 &
    for _ in $(seq 1 30); do
        curl -fsS "http://127.0.0.1:${PORT}/manifest.json" >/dev/null 2>&1 && break
        sleep 1
    done
fi

CLOUDFLARED="${CLOUDFLARED_BIN:-}"
if [[ -z "$CLOUDFLARED" ]] && command -v cloudflared >/dev/null 2>&1; then
    CLOUDFLARED="$(command -v cloudflared)"
fi
if [[ -z "$CLOUDFLARED" && -x "$HOME/.local/bin/cloudflared" ]]; then
    CLOUDFLARED="$HOME/.local/bin/cloudflared"
fi
if [[ -z "$CLOUDFLARED" ]]; then
    case "$(uname -m)" in
        x86_64|amd64) ARCH=amd64 ;;
        aarch64|arm64) ARCH=arm64 ;;
        *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;;
    esac
    mkdir -p "$HOME/.local/bin"
    info "Downloading cloudflared..."
    curl -fsSL \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" \
        -o "$HOME/.local/bin/cloudflared"
    chmod +x "$HOME/.local/bin/cloudflared"
    CLOUDFLARED="$HOME/.local/bin/cloudflared"
fi

LOG=/tmp/stremio-bdix-cloudflared.log
: >"$LOG"
info "Starting HTTPS tunnel..."
"$CLOUDFLARED" tunnel --no-autoupdate --url "http://127.0.0.1:${PORT}" >"$LOG" 2>&1 &
TUNNEL_PID=$!
trap 'kill "$TUNNEL_PID" 2>/dev/null || true' EXIT

URL=""
for _ in $(seq 1 45); do
    URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$LOG" | head -n1 || true)"
    [[ -n "$URL" ]] && break
    sleep 1
done

if [[ -z "$URL" ]]; then
    echo "Could not get tunnel URL. Cloudflared output:" >&2
    cat "$LOG" >&2
    exit 1
fi

DEEP_LINK="stremio://${URL#https://}/manifest.json"

echo
info "=== INSTALL ON PHONE ==="
info "Open this URL in your phone browser:  $URL"
info "Tap INSTALL — Stremio should open and ask you to add the addon."
info
info "Direct deep link:  $DEEP_LINK"
info "Or paste this in Stremio > Addons > Add addon URL:  $URL/manifest.json"
info
info "Phone must be on the same WiFi as the BDIX media servers."
info "Keep this terminal open. Press Ctrl+C to stop the tunnel."
echo

wait "$TUNNEL_PID"
