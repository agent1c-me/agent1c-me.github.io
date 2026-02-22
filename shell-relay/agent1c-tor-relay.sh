#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# Tor Relay wrapper (HTTP fetch path via Tor SOCKS)
: "${AGENT1C_RELAY_PORT:=8766}"
: "${AGENT1C_RELAY_HTTP_PROXY:=socks5h://127.0.0.1:9050}"
export AGENT1C_RELAY_PORT
export AGENT1C_RELAY_HTTP_PROXY

exec "$SCRIPT_DIR/agent1c-relay-core.sh"
