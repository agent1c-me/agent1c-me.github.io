#!/usr/bin/env sh
set -eu

# Backward-compatibility wrapper. New installs should use agent1c-shell-relay.sh.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$SCRIPT_DIR/agent1c-shell-relay.sh"
