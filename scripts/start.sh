#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PORT="${PORT:-3000}"
LOG_DIR="${LOG_DIR:-$ROOT/logs}"
mkdir -p "$LOG_DIR"

mkdir -p "$ROOT/pids"
if [[ -f "$ROOT/pids/server.pid" ]] && kill -0 "$(cat "$ROOT/pids/server.pid")" 2>/dev/null; then
  echo "Servern kör redan (pid $(cat "$ROOT/pids/server.pid"))."
else
  nohup env PORT="$PORT" NODE_ENV="${NODE_ENV:-production}" node "$ROOT/server/index.js" \
    > "$LOG_DIR/server.log" 2>&1 &
  echo $! > "$ROOT/pids/server.pid"
  echo "Startade server pid $(cat "$ROOT/pids/server.pid") på port $PORT"
fi

# Vänta tills health svarar
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then
    break
  fi
  sleep 0.2
done

if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "Servern startade inte. Se $LOG_DIR/server.log" >&2
  exit 1
fi

CLOUDFLARED="${CLOUDFLARED:-$HOME/bin/cloudflared}"
if [[ ! -x "$CLOUDFLARED" ]]; then
  CLOUDFLARED="$(command -v cloudflared || true)"
fi
if [[ -z "$CLOUDFLARED" ]]; then
  echo "cloudflared saknas. Installera den och kör om skriptet." >&2
  exit 1
fi

if [[ -f "$ROOT/pids/tunnel.pid" ]] && kill -0 "$(cat "$ROOT/pids/tunnel.pid")" 2>/dev/null; then
  echo "Tunnel kör redan (pid $(cat "$ROOT/pids/tunnel.pid"))."
else
  : > "$LOG_DIR/tunnel.log"
  nohup "$CLOUDFLARED" tunnel --url "http://127.0.0.1:$PORT" --protocol http2 --no-autoupdate \
    > "$LOG_DIR/tunnel.log" 2>&1 &
  echo $! > "$ROOT/pids/tunnel.pid"
  echo "Startade tunnel pid $(cat "$ROOT/pids/tunnel.pid")"
fi

URL=""
for i in $(seq 1 50); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | tail -n 1 || true)"
  if grep -q "Registered tunnel connection" "$LOG_DIR/tunnel.log" 2>/dev/null && [[ -n "$URL" ]]; then
    break
  fi
  if grep -q "Environment has critical failures" "$LOG_DIR/tunnel.log" 2>/dev/null && [[ "$i" -gt 16 ]]; then
    break
  fi
  sleep 0.25
done

# En URL i loggen räcker inte – anslutningen till Cloudflare Edge måste också lyckas.
if [[ -n "$URL" ]] && grep -q "Registered tunnel connection" "$LOG_DIR/tunnel.log"; then
  echo "$URL" > "$LOG_DIR/public-url.txt"
  echo "ok $URL" > "$LOG_DIR/tunnel-status.txt"
  echo "Publik URL: $URL"
  echo "Obs: Quick-tunnel-adresser är tillfälliga och byts vid omstart."
else
  echo "fail no-edge-connection" > "$LOG_DIR/tunnel-status.txt"
  echo "Servern körs lokalt på http://127.0.0.1:$PORT men ingen publik tunnel kunde öppnas." >&2
  echo "Cloudflare Quick Tunnel kräver utgående trafik till port 7844 (QUIC/HTTP2), vilket ofta är blockerat." >&2
  echo "Se $LOG_DIR/tunnel.log" >&2
  exit 1
fi
