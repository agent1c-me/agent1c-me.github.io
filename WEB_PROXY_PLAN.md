# Web Proxy Plan (Agent1c)

## Why This Exists

The current Hedgey Browser works well for pages that can load directly in an iframe, and it can fall back to relay-fetched HTML for some blocked pages. However, modern sites often fail because subresources (CSS, JS, images, fonts, XHR) are still fetched directly by the browser and can be blocked by:

- CORS
- frame restrictions
- anti-bot systems
- `.onion` resolution (for Tor browsing)

To make the browser genuinely useful, Agent1c needs a **proper web proxy mode**.

This plan covers both codebases:

- `agent1c.me` (local-first)
- `agent1c.ai` (cloud-first)

The proxy architecture should be shared conceptually, with different defaults.

## Product Goal

Make Hedgey Browser able to browse significantly more sites by routing page + subresources through a proxy pipeline, while preserving clear transport choices:

- direct (native iframe/open)
- Shell Relay (localhost proxy, direct HTTP transport)
- Tor Relay (localhost proxy, Tor upstream transport)
- Cloudflare Worker (future default for `agent1c.ai`)

## Key Insight

This is not primarily a "Tor feature." It is a **proxy browsing feature** with multiple transports.

Tor is one transport backend. Shell Relay is another. Cloudflare Worker will be another.

## Scope Split

### Phase A (Unified Proxy Contract)

Define a browser-facing proxy contract that works identically regardless of transport.

### Phase B (`agent1c.me`)

Implement the proxy engine in local relay (Shell/Tor transport).

### Phase C (`agent1c.ai`)

Implement same contract via Cloudflare Worker (and optionally local relay override).

## Browser UX Model

The Browser should keep the current route button behavior and use it to choose transport policy.

### Route Button Modes (already started in `.me`)

- `🖧` direct-first, Shell Relay fallback
- `🧅` direct-first, Tor Relay fallback
- purple `🧅` force Tor proxy mode (always proxied, even iframe-friendly pages)

Future extension:

- cloud route icon for `agent1c.ai` Cloudflare Worker mode

## Why Full Proxy Mode (Instead of Ad-Hoc HTML Rewrite)

The "simple rewrite" approach looks easier initially, but becomes fragile:

- `src`, `href`, `srcset`, CSS `url(...)`, forms, redirects
- JS-generated requests
- CSP/service worker issues

A full proxy mode is easier to keep reliable because:

- one consistent request path
- one response handling pipeline
- transport is abstracted (direct/shell/tor/cloud)
- easier debugging and observability

## Architecture Overview

### 1) Browser Layer (Hedgey Browser)

Browser should request proxied pages/resources via a single contract.

Examples (illustrative):

- `/v1/proxy/page?url=<encoded>`
- `/v1/proxy/resource?rid=<id>&u=<encoded>`

Browser responsibilities:

- choose route mode (direct/shell/tor/cloud)
- render proxied HTML in iframe when proxy mode is used
- preserve Back/Go/Save behavior
- surface clear errors (anti-bot, auth wall, blocked content)

### 2) Proxy Layer (Relay / Worker)

Proxy layer responsibilities:

- fetch upstream page/resource
- normalize headers for browser delivery
- rewrite resource URLs to proxy URLs (centralized)
- optionally track session/cookies per browser window session
- return HTML/resources safely

### 3) Transport Layer (Pluggable)

Proxy fetch transport choices:

- `direct_http` (Shell Relay normal)
- `tor_http` (Tor Relay via `socks5h://127.0.0.1:9050`)
- `cloud_worker_http` (Cloudflare Worker outbound fetch)

## Proxy Contract (Proposed)

This contract should be shared across implementations.

### `GET /v1/proxy/health`

Returns:

- proxy version
- transport kind
- tor status (if relevant)
- limits/caps

### `POST /v1/proxy/open`

Input:

- `url`
- `mode` (`page`)
- optional session id
- optional user agent profile

Returns:

- `ok`
- `content_type`
- `final_url`
- `status_code`
- `headers` (sanitized)
- `body` (for HTML/text)
- `proxy_session_id`
- `title` (optional extracted)
- `proxy_meta` (anti-bot hints, block reason)

### `GET /v1/proxy/resource`

Input query:

- proxy session id
- encoded upstream URL or proxy resource id

Returns:

- raw bytes / streamed body
- sanitized content-type
- cache hints (safe subset)

### `POST /v1/proxy/close` (optional, later)

Allows browser to release session/cookie jar state.

## URL Rewriting Strategy (Centralized)

Even in full proxy mode, some rewriting is still needed, but it must be centralized and systematic.

Rewrite in HTML:

- `href`
- `src`
- `srcset`
- `action`
- `<base>`
- inline CSS `url(...)` where practical

Later (advanced):

- JS URL interception for `fetch` / XHR (injected shim)
- WebSocket proxying (optional, likely out of scope v1)

## Session / Cookie Handling

Needed for many sites to work across multiple requests.

### Minimal v1

- per-browser-window proxy session id
- in-memory cookie jar in relay/worker
- TTL expiry (e.g. 15-30 minutes idle)

### Security guardrails

- session ids random + unguessable
- never expose upstream cookies directly to page JS unless intentionally proxied
- redact auth headers in logs

## Anti-Bot Handling (Important)

Some sites (Google search, Amazon search, etc.) will still fail due to anti-bot systems.

This is expected behavior even with relay/proxy.

Required UX:

- Detect likely anti-bot/interstitial/challenge failure
- Show HedgeyOS-style warning dialog:
  - "This site is enforcing anti-bot protection so Agent1c cannot render it here."
  - Offer "Open in new tab"
- Only show this when relay health is good (so users know this is not a relay outage)

## `.onion` Support

`.onion` support becomes practical only in proxy mode with Tor transport because:

- browser cannot resolve `.onion` directly
- subresources also need to flow through Tor

In Tor force mode (purple `🧅`), Browser should prefer proxy mode for all pages to make `.onion` and complex Tor pages usable.

## Differences Between `agent1c.me` and `agent1c.ai`

### `agent1c.me`

Default philosophy:

- local-first
- user-managed relays
- Tor relay available and visible

Likely defaults:

- direct + Shell fallback (or user preference)
- explicit Tor options via Tor Relay window

### `agent1c.ai`

Default philosophy:

- hosted convenience
- cloud-managed proxy transport (Cloudflare Worker)

Likely defaults:

- direct + Cloudflare Worker fallback
- optional local Shell Relay / Tor Relay overrides for advanced users

## Implementation Phases

### Phase 1: Proxy Contract + Local Relay Endpoint (`agent1c.me`)

- add proxy endpoints to local relay
- implement HTML page fetch + centralized rewrite for subresources
- add resource endpoint
- keep route button behavior
- preserve current fallback behavior if proxy mode errors

### Phase 2: Browser Integration (`agent1c.me`)

- Browser uses proxy mode when relay path chosen and page requires it
- per-window proxy session id
- better status text ("Opened via Shell Relay proxy", "Opened via Tor Relay proxy")
- anti-bot warning dialog + open-in-new-tab action

### Phase 3: Cloudflare Worker Proxy (`agent1c.ai`)

- mirror proxy contract in worker
- worker transport default for browser fallback
- UI status shows cloud proxy vs local relay

### Phase 4: Hardening

- cookie/session TTL cleanup
- resource caching policy
- CSP handling improvements
- telemetry/debug panel (safe, redacted)

## Non-Goals (v1)

- Perfect compatibility with heavily dynamic anti-bot apps
- CAPTCHA solving
- Full browser automation replacement
- WebSocket-heavy app support

## Testing Plan

### Basic pages

- `https://example.com`
- `http://neverssl.com`

### Frame-blocked pages

- LinkedIn (frame blocked, should use proxy path)

### Tor-specific

- simple `.onion` test page (in Tor force mode)

### Failure UX

- Google/Amazon search anti-bot path -> HedgeyOS warning dialog + "Open in new tab"

## Operational Notes

- Keep Shell Relay and Tor Relay as separate processes/ports (`8765`, `8766`)
- Browser transport choice should remain a UI concern, not duplicate browser logic branches
- Reuse the same proxy contract across local relay and Cloudflare Worker implementations

## Documentation / Porting Rule

Implement in one codebase first (prefer `.me` for local relay path), validate end-to-end, then port to `.ai` using the same contract and UI semantics.

## Implementation Status (2026-02-23)

- `.ai` was used as the implementation-first path for the latest proxy pass, then ported to `.me`.
- `.me` now has proxy parity for:
  - P1 proxy endpoints (`/v1/proxy/page`, `/v1/proxy/asset`)
  - browser proxy fallback path + route-button integration
  - experimental web proxy toggle (shared Shell Relay / Tor Relay setting)
  - CSS `url(...)` and `srcset` rewriting
  - canonical proxied link navigation
  - GET form submit bridge (including scripted submits)

### Regression lesson (important)

- Do not add browser-side proxy preflight that performs a second fetch before iframe load.
- Double-fetch caused regressions on some sites (e.g. Yahoo) and was reverted on `.ai`.
- Keep anti-bot handling single-fetch.
