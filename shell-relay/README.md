# Agent1c Shell Relay (Phase 1)

This directory contains the shell-only localhost relay used by Agent1c.

Files:
- `install.sh`: installs relay scripts to `~/.agent1c-relay`
- `agent1c-relay-core.sh`: shared relay launcher core (used by both wrappers)
- `agent1c-shell-relay.sh`: Shell Relay wrapper (direct HTTP fetch, default port `8765`)
- `agent1c-tor-relay.sh`: Tor Relay wrapper (Tor-proxied HTTP fetch, default port `8766`)
- `agent1c-relay.sh`: backward-compatibility wrapper -> `agent1c-shell-relay.sh`
- `handler.sh`: HTTP request handler (`/v1/health`, `/v1/shell/exec`, `/v1/http/fetch`, `/v1/tor/status`)

Dependencies:
- `socat`
- `jq`

Quick start:

```sh
curl -fsSL https://agent1c.me/shell-relay/install.sh | sh
~/.agent1c-relay/agent1c-shell-relay.sh
```

Tor Relay (separate process / port):

```sh
~/.agent1c-relay/agent1c-tor-relay.sh
```
