# Agent1c.me

Agent1c.me is a serverless, AI-enabled browser OS built on HedgeyOS (`hedgeyos.github.io`).

It runs entirely inside a browser tab with no app server. If the tab stays open, Hitomi can keep running autonomous loops and can control a Telegram bot through the configured Bot API token. If the tab closes, runtime stops.

No logins, no installations, just API attach.

## What It Is

- Local-first autonomous agent workspace inside a retro web desktop
- Bring Your Own Keys (BYOK): OpenAI and Telegram credentials are user-provided
- Vault encryption in-browser for stored provider credentials
- Direct provider calls from browser to provider APIs
- No backend required for MVP

## Built On HedgeyOS

This project is built on HedgeyOS and reuses its browser OS foundations:

- Window manager and desktop shell
- Menubar and app-launch model
- Theme system
- IndexedDB-backed local persistence patterns

Agent1c.me and HedgeyOS are both by Decentricity.

## Core Capabilities

- Top-level agent windows in HedgeyOS (Chat, OpenAI API, Telegram API, Loop, SOUL.md, heartbeat.md, Events)
- Local threaded chat with rolling context
- Per-thread memory for local chats
- Per-chat-id memory isolation for Telegram chats
- Heartbeat loop and event timeline
- Tile and Arrange window controls in the menubar

## Onboarding Flow

1. First load: only `Create Vault` is shown.
2. After vault creation: `OpenAI API` and `Events` are shown.
3. User must complete OpenAI setup:
   - Save encrypted OpenAI key
   - Test OpenAI connection
   - Save OpenAI settings (model and temperature)
4. After setup is complete, OpenAI window minimizes and the rest of the agent workspace appears.
5. Telegram setup is optional, but required for Telegram bot bridging.

## Security Model (MVP)

- Credentials are encrypted at rest in-browser
- Vault unlock is passphrase-based
- No third-party app login flow required for MVP
- Provider secrets are not sent to any agent1c server because there is no agent1c server in this architecture

## Runtime Notes

- Agent runtime is tab-bound.
- Locking vault protects secret access, while loop intent can continue and resume API work after unlock.
- Telegram bridge runs only when enabled and when required credentials are available.

## Local Run

```bash
cd agent1c-me.github.io
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Live

- Production domain: `https://agent1c.me`
- GitHub Pages repo: `https://github.com/agent1c-me/agent1c-me.github.io`

## Development Notes

- Vanilla HTML, CSS, and JavaScript (no npm dependency chain)
- Changes should preserve HedgeyOS baseline behavior unless intentionally modified
- Integration notes and guardrails are documented in `agents.md`
