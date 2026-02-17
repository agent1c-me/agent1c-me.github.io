# Agent1c Local Relay (Phase 1)

This relay lets Agent1c call local shell commands via `shell_exec`.

## Safety First

- Run as a normal user account.
- Do not run as `root`.
- Do not run with `sudo`.
- Keep it bound to `127.0.0.1`.

## Start

```bash
cd local-relay
python3 agent1c_local_relay.py
```

Optional token:

```bash
export AGENT1C_RELAY_TOKEN="change-me"
python3 agent1c_local_relay.py
```

## Optional Env Vars

- `AGENT1C_RELAY_HOST` (default: `127.0.0.1`)
- `AGENT1C_RELAY_PORT` (default: `8765`)
- `AGENT1C_RELAY_TOKEN` (default: empty)
- `AGENT1C_RELAY_ALLOW_ORIGINS` (comma-separated origins)
- `AGENT1C_RELAY_MAX_OUTPUT_CHARS` (default: `65536`)
- `AGENT1C_RELAY_DEFAULT_TIMEOUT_MS` (default: `30000`)

## Agent1c Config

In Agent1c `Config` window:

- Relay: `Enabled`
- Relay URL: `http://127.0.0.1:8765`
- Relay token: same value as `AGENT1C_RELAY_TOKEN` if set
- Click `Test Relay`

