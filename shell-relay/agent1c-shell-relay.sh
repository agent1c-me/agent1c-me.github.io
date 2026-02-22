#!/usr/bin/env sh
set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# Shell Relay (direct transport) wrapper
: "${AGENT1C_RELAY_PORT:=8765}"
export AGENT1C_RELAY_PORT
unset AGENT1C_RELAY_HTTP_PROXY || true

exec "$SCRIPT_DIR/agent1c-relay-core.sh"
