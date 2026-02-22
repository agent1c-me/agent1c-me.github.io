#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

HOST="${AGENT1C_RELAY_HOST:-127.0.0.1}"
PORT="${AGENT1C_RELAY_PORT:-8765}"
TOKEN="${AGENT1C_RELAY_TOKEN:-}"
MAX_OUTPUT_CHARS="${AGENT1C_RELAY_MAX_OUTPUT_CHARS:-65536}"
DEFAULT_TIMEOUT_MS="${AGENT1C_RELAY_DEFAULT_TIMEOUT_MS:-30000}"
HTTP_PROXY="${AGENT1C_RELAY_HTTP_PROXY:-}"
ALLOW_ORIGINS="${AGENT1C_RELAY_ALLOW_ORIGINS:-https://agent1c.me,https://www.agent1c.me,http://localhost:8000,http://127.0.0.1:8000}"

if [ "$HOST" != "127.0.0.1" ]; then
  echo "[agent1c-relay] forcing loopback bind (127.0.0.1)"
  HOST="127.0.0.1"
fi

if ! command -v socat >/dev/null 2>&1; then
  echo "[agent1c-relay] missing dependency: socat"
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "[agent1c-relay] missing dependency: jq"
  exit 1
fi

echo "[agent1c-relay] starting on $HOST:$PORT"
echo "[agent1c-relay] allowed origins: $ALLOW_ORIGINS"
if [ -n "$TOKEN" ]; then
  echo "[agent1c-relay] token auth: enabled"
else
  echo "[agent1c-relay] token auth: disabled"
fi
if [ -n "$HTTP_PROXY" ]; then
  echo "[agent1c-relay] http fetch transport: proxied via $HTTP_PROXY"
else
  echo "[agent1c-relay] http fetch transport: direct"
fi
echo "[agent1c-relay] warning: run as non-root user only"

export AGENT1C_RELAY_HOST="$HOST"
export AGENT1C_RELAY_PORT="$PORT"
export AGENT1C_RELAY_TOKEN="$TOKEN"
export AGENT1C_RELAY_MAX_OUTPUT_CHARS="$MAX_OUTPUT_CHARS"
export AGENT1C_RELAY_DEFAULT_TIMEOUT_MS="$DEFAULT_TIMEOUT_MS"
export AGENT1C_RELAY_HTTP_PROXY="$HTTP_PROXY"
export AGENT1C_RELAY_ALLOW_ORIGINS="$ALLOW_ORIGINS"

exec socat "TCP-LISTEN:${PORT},bind=${HOST},reuseaddr,fork" "EXEC:${SCRIPT_DIR}/handler.sh"
