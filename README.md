# Agent1c.me

Agent1c.me is a serverless, AI-enabled browser OS built on HedgeyOS (`hedgeyos.github.io`).

It runs entirely inside a browser tab with no app server. If the tab stays open, Hitomi can keep running autonomous loops and can control a Telegram bot through the configured Bot API token. If the tab closes, runtime stops.

No logins, no installations, just API attach.

## What It Is

- Local-first autonomous agent workspace inside a retro web desktop
- Bring Your Own Keys (BYOK): OpenAI, Anthropic, xAI (Grok), z.ai, and Telegram credentials are user-provided
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

- Top-level agent windows in HedgeyOS (Chat, AI APIs, Telegram API, Loop, SOUL.md, TOOLS.md, heartbeat.md, Events)
- Local threaded chat with rolling context
- Per-thread memory for local chats
- Per-chat-id memory isolation for Telegram chats
- Heartbeat loop and event timeline
- Tile and Arrange window controls in the menubar
- Multi-provider runtime routing:
  - OpenAI (`https://api.openai.com/v1/chat/completions`)
  - Anthropic (`https://api.anthropic.com/v1/messages`)
  - xAI Grok (`https://api.x.ai/v1/chat/completions`)
  - z.ai (`https://open.bigmodel.cn/api/paas/v4/chat/completions`)

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

## AI Provider Architecture

- Provider setup is unified in the `AI APIs` window:
  - Select a provider card
  - Save encrypted key
  - Provider key validation runs immediately
  - On success, provider can become active
  - Model selection is stored per provider
- Active provider controls local chat, heartbeat responses, and Telegram replies.
- Onboarding continues when at least one AI provider key is valid.

## Grok Integration Notes

- xAI (Grok) is fully wired, not preview-only.
- Supported fallback models currently shown in UI:
  - `grok-4`
  - `grok-3`
  - `grok-3-mini`
- Key validation is live using xAI API calls.
- xAI status and key/model controls follow the same card behavior as Anthropic and z.ai.

## How To Add Another Provider

1. Add provider state fields (`key`, `model`, `validated`) to preview/provider state.
2. Add provider card UI in `AI APIs` window and wire card DOM IDs.
3. Add provider chat function (endpoint + headers + response parsing).
4. Add provider validation function and include it in `validateProviderKey(...)`.
5. Include provider in:
   - provider normalization
   - display name mapping
   - active runtime secret resolution
   - provider badge/pill refresh
   - onboarding key checks
   - lock/unlock UI disable handling
6. Route chat/heartbeat/Telegram through the unified provider runtime path.
7. Keep wording aligned: avoid "Preview" once provider is fully wired.

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
