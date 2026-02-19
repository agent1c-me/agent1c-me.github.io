## HedgeyOS Implementation Notes (Verified)

Scope:
- Repository audited: `/home/decentricity/hedgeyos.github.io`
- Goal of this file: implementation-accurate notes for future agents, especially for integration work.

Important:
- This document is based on code behavior, not README claims.

---

## 1) High-level architecture

HedgeyOS is a static web desktop built with:
- Vanilla JS ES modules (`js/*.js`)
- Static `index.html` templates
- CSS theming via body classes and variables (`styles.css`)
- IndexedDB for encrypted files (`hedgeyfs`)
- localStorage for settings, notes draft, and UI state

No bundler/build required for core desktop.

Primary boot:
- `index.html` loads `js/main.js` as type module.

Core modules:
- `js/main.js`: orchestrator/boot wiring
- `js/wm.js`: window manager + app window wiring
- `js/filesystem.js`: encrypted file store + key wrapping/unlocking
- `js/menubar.js`: menubar dropdown interactions + actions
- `js/apps-menu.js`: Apps menu and category flyouts
- `js/storage.js`: saved app links management
- `js/theme.js`: theme + dark mode state
- `js/desktop-icons.js`: desktop icon rendering/placement
- `js/save-dialog.js`: save-app modal
- `js/embedify.js`: media URL to embeddable URL conversion
- `js/hud.js`: camera HUD overlay control

---

## 2) Boot sequence and startup behavior (`js/main.js`)

Boot sequence:
1. Fetch `apps.json` (no-store cache mode).
2. Convert app list to `appsMap` keyed by app id.
3. Create:
- apps menu manager
- save-app dialog
- window manager
- HUD controller
4. Wire menu dropdown behavior and menu action handlers.
5. Init theme toggle and restore current theme.
6. Render apps and saved apps menus.
7. Create startup windows (Files, Notes, Themes), then reposition them.
8. Setup encryption toast and key modal operations.
9. Setup global file drag/drop upload flow.

Startup windows created:
- Files at `{left:32, top:32}`
- Notes at `{left:276, top:88}`
- Themes at `{left:520, top:144}`

Potential bug observed:
- `main.js` references `firstBoot` near end but no declaration is visible in file.
- This should be verified/fixed before relying on first-boot behavior.

---

## 3) Window manager contract (`index.html` + `js/wm.js`)

Template-based spawning in `index.html`:
- `#finderTemplate`
- `#appTemplate`
- `#browserTemplate`
- `#notesTemplate`
- `#themesTemplate`

Required window DOM hooks used by WM:
- Root: `[data-win]`
- Titlebar drag target: `[data-titlebar]`
- Controls:
- `[data-close]`
- `[data-minimize]`
- `[data-zoom]`
- Window title text target: `[data-titletext]`
- Resize handle: `[data-grip]`

WM internal model (`state` map per window id):
- `win` DOM node
- `minimized` bool
- `maximized` bool
- `restoreRect` for zoom toggle
- `title`
- `kind`
- `createdAt`

Window IDs:
- Generated as `w1`, `w2`, etc in `spawn()`.
- Stored on node as `data-id`.

Window kinds:
- `files`, `browser`, `notes`, `app`, default `window`

Core behaviors:
- Focus: z-index bump + inactive class toggling.
- Minimize: `display: none`.
- Restore: `display: grid`.
- Close: DOM remove + state delete.
- Zoom toggle: stores/restores rect to desktop-filling rect.
- Drag: pointer events on titlebar, ignores control hits, supports tilt animation while dragging.
- Resize: pointer events on grip, min size 320x240, clamped to desktop region.

WM exported API:
- `createFilesWindow()`
- `createBrowserWindow()`
- `createNotesWindow(notesOpts?)`
- `createTerminalWindow()`
- `createAppWindow(title, url)`
- `createThemesWindow()`
- `focusDocumentsWindow()`
- `refreshOpenWindowsMenu()`
- `refreshIcons()`
- `focus(id)`
- `restore(id)`

---

## 4) Finder/files integration (`wm.js` + `filesystem.js`)

Finder sections:
- Applications
- Encrypted Files
- System Folder
- Desktop

How section rows are built:
- Applications:
- default apps from `apps.json`
- saved apps from localStorage (`storage.js`)
- Encrypted Files:
- all files from IndexedDB `files` store
- System Folder:
- hardcoded Terminal and Files rows
- Desktop:
- tagged file ids from encrypted meta `desktopTags`

Row actions:
- Terminal -> spawn terminal app window
- Files -> spawn files window
- Note -> open Notes window with file id
- Download -> decrypt/open or download file
- App -> spawn app window with URL

Context action in Encrypted Files:
- “Add to Desktop” (desktop tag list update)

Custom events used:
- `hedgey:docs-changed` triggers Finder refresh in relevant sections.

---

## 5) File opening behavior (`wm.js` openFileById)

File open routing logic:
- `kind === note`: open Notes with `fileId`.
- HTML files: create object URL -> open app iframe.
- Text-ish files/extensions: decode to text -> open Notes prefilled.
- Previewable media (image/video/audio/pdf): create object URL -> open app iframe.
- Otherwise: prompt decrypt/download modal.

Object URLs for preview app windows are revoked after timeout (~20s).

---

## 6) Notes behavior and persistence (`wm.js`)

Notes has two persistence paths:
1. Draft/local working buffer in localStorage key `hedgeyos_notes_v1`.
2. Encrypted saved note files in IndexedDB via `saveNote()`.

Autosave behavior:
- On input: status “Typing...” and debounce save after 1s idle.
- On blur: immediate save to localStorage draft.

Open/Save behavior:
- Open dialog lists encrypted note records from IndexedDB.
- Save button writes encrypted note record; may prompt for filename when needed.

Implication:
- Draft can exist unencrypted in localStorage unless user explicitly saves as encrypted note file.

---

## 7) Encrypted filesystem and key management (`js/filesystem.js`)

IndexedDB:
- DB: `hedgeyfs`
- Version: `2`
- Stores:
- `files` (keyPath `id`; indexes `kind`, `updatedAt`)
- `meta` (keyPath `id`)

Meta keys:
- `cryptoKeyWrapped`: holds encryption key metadata.
- `desktopTags`: encrypted JSON array of file IDs pinned to desktop.

Content encryption:
- AES-GCM 256-bit per file payload.
- Random IV per record.
- Cipher stored as Blob.

Key model (very important):
- First-run default creates AES key and stores it as **JWK in meta** (unwrapped at rest).
- Optional passphrase wraps the key and stores wrapped payload (`wrapped`, `salt`, `iterations`, `wrapIv`).
- KDF for passphrase wrapping: PBKDF2 SHA-256, 250000 iterations.
- Unlock path unpacks wrapped key and caches it in memory.

Runtime key state:
- `cachedKey` holds active key in memory.
- If only wrapped key exists and no cached key, filesystem operations wait on unlock promise.

Encryption notice behavior:
- After encrypted writes, one-time localStorage flag `hedgey_encryption_notice_v1` is set.
- Dispatches `hedgey:encryption-notice` to current window and parent (if embedded).

Public filesystem API:
- `hasWrappedKey()`
- `setPassphrase(passphrase)`
- `unlockWithPassphrase(passphrase)`
- `listFiles()` / `getFileById(id)`
- `saveNote({id,name,content})`
- `saveUpload(file)`
- `downloadFile(id)`
- `listNotes()` / `listUploads()`
- `readNoteText(id)`
- `readFileBlob(id)`
- `listDesktopTags()` / `addDesktopTag(fileId)`

---

## 8) Security posture (implementation-accurate)

What is encrypted:
- IndexedDB file payloads (when saved through filesystem module).
- Desktop tags metadata is encrypted.

What is not necessarily encrypted:
- Saved app links in localStorage.
- Theme/dark mode prefs in localStorage.
- Notes draft localStorage key (`hedgeyos_notes_v1`).
- On first run, key may be stored as plain JWK in IndexedDB until passphrase wrapping is applied.

Iframe isolation:
- App/browser iframes in `index.html` do **not** use a `sandbox` attribute currently.
- They are same-origin for local app paths and unrestricted by sandbox token policy.

COI service worker:
- `coi-serviceworker.js` exists.
- `index.html` sets:
- `window.coi.shouldRegister: () => false`
- `window.coi.shouldDeregister: () => true`
- Effectively disables persistent registration and prefers deregistration.
- So crossOriginIsolated mode is not actively enforced by default.

README mismatch note:
- README mentions sandboxed apps and COI security posture broadly.
- Current code should be treated as source of truth for real behavior.

---

## 9) Menus, actions, events

Menubar dropdown mechanics (`menubar.js`):
- Click to open specific menu.
- Outside click or Esc closes all menus.

Menu actions route to WM:
- Full Screen
- HUD toggle
- Open Themes
- About
- New Files
- New Notes
- App launch by app id

Global custom events:
- `hedgey:open-app`
- `hedgey:docs-changed`
- `hedgey:encryption-notice`
- `hedgey:upload-complete`
- `hedgey:close-upload`

Upload app bridge:
- `apps/upload/app.js` saves files through parent filesystem module.
- Dispatches docs/upload/close events to parent window.

---

## 10) Theme system (`theme.js` + `styles.css`)

Theme key:
- localStorage `hedgeyos_theme_v1`

Dark mode key:
- localStorage `hedgeyos_dark_mode`

Allowed themes in code:
- `beos`
- `system7`
- `greenscreen`
- `cyberpunk`
- `hedgeyOS`

Fallback quirk:
- `getTheme()` defaults to string `hedgey`, but `applyTheme()` only allows above list and falls back to `hedgey` behavior (which means no specific body class toggled for non-listed theme).

HedgeyOS visual mode:
- `body.hedgeyOS` uses bottom tab titlebars and adjusted window row ordering.

---

## 11) Apps and external integrations

`apps.json` drives app catalog shown in menu.
Common bundled app URLs include:
- About
- Games/utilities/media pages
- Local apps (`apps/upload`, `apps/rss`, etc.)

Terminal app:
- Uses v86 (`vendor/v86/libv86.js`) to boot Buildroot Linux image in-browser.

Browser window embed behavior:
- Uses `embedify.js` conversion for YouTube/Vimeo/Spotify/SoundCloud/Twitch/Loom/Google links.
- Twitch embedding requires parent host param.

---

## 12) Known issues / caveats to verify before major integration

1. `firstBoot` reference appears undefined in `main.js`.
2. Draft Notes in localStorage are not encrypted.
3. First-run key may be unwrapped-at-rest (JWK) until passphrase is explicitly set.
4. App iframes lack sandbox restrictions.
5. COI SW logic is present but registration disabled in `index.html` configuration.
6. WM minimize model is hide/show, not windowshade tabs.

---

## 13) Integration guidance for future agent work

When integrating a new app into HedgeyOS:
1. Use existing WM spawn APIs and data attributes (`data-win`, `data-titlebar`, etc.).
2. Reuse `filesystem.js` for encrypted persistence instead of adding separate DB/crypto logic.
3. Prefer custom events (`hedgey:*`) for cross-module synchronization.
4. Keep theme styling keyed to body classes and CSS vars.
5. Validate assumptions against code, not README.
6. Treat HedgeyOS as an OS-level baseline: changes must be minimal, isolated, and reversible.
7. NEVER change global defaults/fallbacks when implementing first-run behavior; gate first-run logic in first-run code paths only.
8. NEVER mix unrelated visual/theme changes with functional fixes in the same patch.
9. NEVER touch theme fallback semantics unless explicitly requested and validated against manual theme switching.
10. If a change breaks default boot behavior, revert immediately and re-apply a smaller patch.
11. Before implementing any feature, restate the product's core intent from the initial user discussion and verify the change does not undermine that intent.
12. For agent1c specifically: preserve autonomous tab-runtime behavior. Vault lock/unlock must protect keys without silently disabling the running agent loop.

When hardening security:
1. Decide whether passphrase should be mandatory on first run.
2. Remove unwrapped-JWK at-rest fallback if threat model requires.
3. Encrypt notes draft path or remove localStorage drafts.
4. Add iframe sandbox policy for untrusted app URLs.
5. Re-enable and test COI strategy intentionally (or document why disabled).

---

## 14) Agent1c OS Integration Record (What Was Built)

Product intent (source of truth from user):
- Build `agent1c.me` as a local-first autonomous agent app that runs in a browser tab.
- BYOK model: provider keys stay local, encrypted in-browser, never sent to non-provider servers.
- No dependency on app servers for MVP.
- HedgeyOS is the shell/OS; agent1c windows must be native top-level HedgeyOS windows (not nested WM).

Integration baseline:
- `hedgeyos3000` was reset from a clean copy of `hedgeyos.github.io` multiple times to remove regressions.
- Final direction: keep HedgeyOS window manager and theme system as primary; integrate agent1c logic/content into HedgeyOS app windows.

Primary files added/changed for integration:
- `js/agent1c.js`: agent state, vault crypto, provider storage, chat, heartbeat, Telegram bridge, onboarding orchestration.
- `js/wm.js`: agent panel spawn helper, tile/arrange behavior updates, icon-safe layout.
- `js/menubar.js`: menu actions for `Arrange` and `Tile`.
- `js/desktop-icons.js`: agent-specific desktop glyph mapping.
- `styles.css`: agent window content styles, notepad layout, compact provider-row styles.
- `index.html` + `js/main.js` wiring to load/initialize agent module in HedgeyOS runtime.

Window model (current):
- Top-level windows in HedgeyOS WM:
- `Chat`
- `OpenAI API`
- `Telegram API`
- `Loop`
- `SOUL.md`
- `heartbeat.md`
- `Events`
- `Create Vault` and `Unlock Vault` modal-like windows as needed
- No nested window manager inside any agent window.

Onboarding flow implemented:
1. First boot with no vault:
- Only `Create Vault` window is shown.
2. After vault creation:
- Show `OpenAI API` + `Events`.
- Other agent windows remain minimized.
3. Onboarding gate:
- User must complete all three for OpenAI:
- Save encrypted key
- Test connection
- Save OpenAI settings
4. On success:
- OpenAI window minimizes.
- Chat and other operational windows are revealed.
5. `SOUL.md` and `heartbeat.md` start minimized on first onboarding completion.

Chat and memory model (current):
- Local chat supports multiple threads via dropdown.
- `New Chat` creates a new local thread.
- `Clear Chat` clears active thread context.
- Auto-scroll to bottom after each user/assistant message.
- Telegram chats are mapped to per-chat-id threads:
- Thread id format: `telegram:<chatId>`
- Separate memory/context per Telegram chat
- Telegram threads are included in the shared chat-thread selector.

Provider UX behavior (current):
- OpenAI and Telegram windows support encrypted key/token save + test.
- If provider key/token already exists in vault:
- Save/Test controls are hidden.
- Compact text row shown:
- `OpenAI API Key Stored in Vault`
- `Telegram API Key Stored in Vault`
- Pencil button (`✎`) reopens edit controls on demand.

Loop and lock behavior (critical invariant):
- `Start Loop` starts heartbeat runtime.
- Telegram polling runs when enabled and unlocked.
- Locking vault clears session key/unlock state but MUST NOT kill runtime intent.
- Current behavior:
- `lockVault()` does not stop loop timers.
- Work requiring decrypted keys is skipped until unlock.
- After unlock, runtime continues without requiring `Start Loop` again.

SOUL/heartbeat editor behavior:
- Both use notepad-like layout with left row numbers.
- Row numbers populate on launch (not only after first edit).

Theme and visual constraints adopted:
- HedgeyOS theme must remain valid and selectable without breakage.
- Default/fallback theme semantics are treated as high-risk; avoid touching unless explicitly required and tested.
- Avoid broad CSS changes that alter core HedgeyOS window chrome/layout behavior.

Window manager interactions added/updated:
- Titlebar shade/rehydrate interactions were iterated earlier in custom WM phase; final HedgeyOS integration favors native HedgeyOS window controls and behavior.
- Menubar now includes:
- `Arrange`: arrange visible windows.
- `Tile`: tile visible windows; second tile click untile+arrange.
- Additional current rule:
- If tiled state is active and user clicks `Arrange`, it first untile-restores and then arranges.
- Tile/Arrange reserve icon rows:
- Layout engine computes bottom icon reserve dynamically from icon count and icon grid metrics.
- Auto-layout avoids placing windows over desktop icon rows.
- Manual dragging can still place windows over icons (by design).

Mobile behavior goals implemented:
- No horizontal page scrolling dependency.
- Windows can overlap on smaller viewports.
- Drag interactions tuned to avoid scroll collisions as much as possible in HedgeyOS constraints.

Deployment pattern used:
- Active deploy target: `decentricity.github.io/agent1c_os` (branch `gh-pages`).
- Local source of record during implementation: `/home/decentricity/hedgeyos3000`.
- Typical sync: rsync from `hedgeyos3000` to `decentricity.github.io/agent1c_os`, then commit/push.

---

## 15) Regression Lessons (Do Not Repeat)

1. Never introduce nested window managers for agent1c inside HedgeyOS.
2. Never rewrite HedgeyOS theme plumbing for a small feature request.
3. Never change fallback theme names/semantics without explicit request and test.
4. Never make broad global CSS edits to fix local agent-window issues.
5. Never stop autonomous runtime as a side-effect of vault lock.
6. Always verify product intent before coding:
- For agent1c, autonomy in-tab is primary; security controls must not silently disable core agent behavior.
7. Prefer smallest possible patch in HedgeyOS core files (`wm.js`, `theme.js`, `main.js`).
8. If behavior regresses, revert quickly and re-apply a narrower change.
9. Do not add speculative behavioral heuristics (for example: away detection, throttling, gating, silent fallbacks) unless explicitly requested.
10. If a behavior policy is ambiguous, default to deterministic always-on execution and ask before adding conditional logic.
11. Never replace existing user-visible behavior with a "smart" alternative without confirming.
12. Before merge, run a "did I invent extra behavior?" check and remove anything not in user requirements.

---

## 16) Current Behavioral Contract (Quick Checklist)

- Agent windows are top-level HedgeyOS windows.
- First run shows only `Create Vault`.
- OpenAI onboarding gate controls when full workspace appears.
- Telegram uses per-chat-id memory and appears in chat thread list.
- Provider windows collapse controls when keys are already stored.
- Chat auto-scrolls to newest message.
- SOUL/heartbeat look like notepad with live row numbers.
- Tile/Arrange avoid desktop icon rows dynamically.
- Arrange while tiled performs untile+arrange.
- Vault lock protects key access but does not terminate loop intent.
- Heartbeat runs on configured loop schedule; no implicit away/presence gating unless explicitly requested.

---

## 17) Provider Integration Record: xAI (Grok)

What was implemented for xAI:
- Added xAI as a first-class provider in `AI APIs`, positioned directly below Anthropic.
- Added active-provider selector option for xAI.
- Added encrypted vault key save + immediate validation flow for xAI.
- Added per-provider model persistence for xAI.
- Added runtime routing so local chat, heartbeat, and Telegram replies use xAI when xAI is active.
- Added badge/pill status updates and lock-state disable handling for xAI controls.
- Added onboarding key checks to include xAI as a valid AI-provider unlock path.

Runtime endpoint and auth:
- Base URL: `https://api.x.ai/v1`
- Chat endpoint: `/chat/completions`
- Auth header: `Authorization: Bearer <xai_key>`
- Parsing model: OpenAI-compatible `choices[0].message.content`.

Fallback model list used in UI:
- `grok-4`
- `grok-3`
- `grok-3-mini`

Primary code touchpoints used (pattern to reuse for future providers):
- Provider constants and fallback model IDs:
  - `FALLBACK_*_MODELS`
- Preview/provider state:
  - `previewProviderState.{provider}Key`
  - `previewProviderState.{provider}Model`
  - `previewProviderState.{provider}Validated`
  - `loadPreviewProviderState()` / `persistPreviewProviderState()`
- Provider UI state rendering:
  - `refreshProviderPreviewUi()`
- Provider API function:
  - `{provider}Chat(...)`
- Provider routing and naming:
  - `normalizeProvider(...)`
  - `activeProviderModel(...)`
  - `providerDisplayName(...)`
  - `resolveActiveProviderRuntime(...)`
  - `providerHasKey(...)`
  - `providerChat(...)`
- Provider validation:
  - `test{Provider}Key(...)`
  - `validateProviderKey(...)`
- UX/wiring:
  - `openAiWindowHtml()` provider card markup
  - `cacheElements()` IDs
  - `refreshBadges()` pills and badges
  - `refreshUi()` disable/enable on lock
  - `wireProviderPreviewDom()` save/edit/model handlers
- Onboarding/global key checks:
  - `hasAnyAiProviderKey()`

Future-provider integration checklist (do this in order):
1. Add fallback model IDs and provider state fields.
2. Add provider card UI and DOM IDs.
3. Implement provider API call helper (`{provider}Chat`).
4. Implement provider key test (`test{Provider}Key`) and validation branch.
5. Include provider in all provider normalization/runtime/key checks.
6. Add save/edit/model handlers in `wireProviderPreviewDom()`.
7. Add provider badge/pill updates in `refreshBadges()`.
8. Add lock-state disable rules in `refreshUi()`.
9. Include provider in `hasAnyAiProviderKey()` so onboarding gates work.
10. Confirm wording has no stale `Preview`/`Test` labels once wired.
11. Run full regression path:
   - lock/unlock
   - onboarding gate
   - local chat reply
   - heartbeat reply
   - Telegram reply

Guardrails:
- Keep provider integration inside `js/agent1c.js` unless absolutely required elsewhere.
- Do not alter HedgeyOS core WM/theme behavior for provider work.
- Avoid speculative UX rewrites; keep provider rows/cards behavior consistent.

---

## 18) Planned Architecture: Localhost Shell Bridge (No Cloud Backend)

Status:
- Planned only. Not implemented yet.
- This section is the architecture contract for future work.

Goal:
- Let Hitomi execute host OS shell commands through a localhost relay process.
- Keep browser-only app model (`agent1c.me`) while delegating privileged operations to a local process explicitly installed by the user.

Why this exists:
- HedgeyOS/Agent1c currently cannot reliably access arbitrary web APIs due to CORS and cannot execute host shell directly from browser.
- A localhost relay can:
  1. provide safe CORS-enabled bridge for tools
  2. execute shell commands
  3. later proxy external HTTP for HedgeyOS Browser and tools.

### 18.1 Security model (must-have)

1. Bind relay to loopback only:
- `127.0.0.1` (or `localhost`) only, never public bind.

2. Strict CORS allowlist:
- Allow only `https://agent1c.me` and optional dev origins (`http://localhost:*`).
- Reject all other `Origin`.

3. Local auth token:
- Relay generates a random token on first run.
- Browser must send token in header (for example `X-Agent1c-Token`).
- Relay rejects missing/invalid token.
- Token entered once in Agent1c UI and stored locally (vault if available).

4. Non-sudo runtime warning:
- Setup docs must instruct users to run relay as a non-sudo, non-admin user.
- Explicit warning: do not run relay as root.

5. Command execution constraints:
- Initial version should support command timeout, output-size caps, and single-command execution per request.
- Hard cap stdout/stderr bytes and return head/tail if large.

6. Auditability:
- Every command call/result is logged in Events with timestamp, command summary, exit code.

### 18.2 Proposed relay API contract (v1)

Minimal endpoints:
- `GET /v1/health` -> relay status/version
- `POST /v1/shell/exec` -> execute one command
- `POST /v1/http/fetch` (future) -> CORS-safe external fetch proxy

Shell request payload (`/v1/shell/exec`):
- `command` (string)
- `cwd` (optional)
- `timeout_ms` (optional, capped)

Shell response payload:
- `ok` (bool)
- `exit_code` (int)
- `stdout` (possibly truncated)
- `stderr` (possibly truncated)
- `truncated` (bool)
- `duration_ms` (int)

### 18.3 Tool-call parser contract in Agent1c

Tool call style remains inline token (no forced JSON mode):
- Example: `{{tool:shell_exec|command=ls -la}}`

Parser behavior:
- Parse only explicit `tool:shell_exec` token.
- Execute relay call.
- Inject `TOOL_RESULT shell_exec ...` back into model loop.
- Preserve existing multi-step tool loop behavior.

Important:
- Parser should not attempt natural-language command inference outside explicit tool tokens.
- Keep deterministic parse path to avoid accidental shell execution.

### 18.4 Prompt updates required

`TOOLS.md` updates (planned):
- Add `shell_exec` tool syntax and parameter rules.
- Add output-size expectation (head/tail truncation possible).
- Require concise command usage and result-grounded answers.

`SOUL.md` updates (planned):
- Clarify that Hitomi can access host OS via local relay tool when user enables it.
- Reinforce safety behavior:
  - never claim command succeeded without tool result
  - prefer low-risk inspection first
  - ask before destructive actions.

### 18.5 UX flow (based on Ollama Setup pattern)

Add a new setup window:
- Name: `Shell Relay`
- Triggered from Connection/API area.
- HedgeyOS-native window (no custom non-native panel).

Flow:
1. User picks OS (Linux/macOS/Android).
2. Show copyable setup commands in code blocks (with copy buttons).
3. Include explicit non-sudo warning in setup text.
4. User starts relay locally.
5. User enters relay URL/token in Agent1c.
6. User presses `Test Relay` -> show health check result.

### 18.6 Execution safeguards (phased)

Phase 1 (MVP):
- Direct shell execution with timeout/output caps.
- Explicit token-auth + origin-check.
- Event logging.

Phase 2:
- Optional allowlist mode for commands.
- Optional user-confirmation gate for mutating commands.

Phase 3:
- Reuse same relay for CORS proxy (`/v1/http/fetch`) to support HedgeyOS Browser/tooling.

### 18.7 Integration boundaries

- Keep HedgeyOS window manager/theme core untouched as much as possible.
- Implement UI/tooling mostly in `js/agent1c.js` and modular helper files.
- Relay process is external (separate repo or script package).

### 18.8 Acceptance criteria (before calling done)

1. User can install relay from setup instructions on supported OS.
2. Browser can authenticate relay and pass health check.
3. Hitomi can execute explicit `shell_exec` tool call and receive deterministic result.
4. Events timeline records command actions and outcomes.
5. No regression to existing provider/chat/loop flows.

### 18.9 Phase 1 implementation status (current)

- Contract source of truth: `PHASE1_CONTRACT.md`.
- Relay logic must be modularized in `js/agent1crelay.js`.
- `js/agent1c.js` should remain thin integration for:
  - window spawn/wiring
  - tool dispatch hook
  - state persistence handoff

Implemented direction in this pass:
- Dedicated `Shell Relay` top-level window (not inside `Config`).
- Shell-only relay runtime scripts under `shell-relay/`:
  - `install.sh`
  - `agent1c-relay.sh`
  - `handler.sh`
- Setup flow is OS-first with copyable command blocks in `Shell Relay`.
- Tool contract includes `shell_exec` via inline token flow and result injection.

---

## 19) Phase 2 plan snapshot: Hitomi control of HedgeyOS actions

This section summarizes the current agreed direction.
The execution contract is now in `PHASE2_PLAN.md`.

### 19.1 Product intent

- Hitomi (Chat 1) should control core HedgeyOS actions as an integrated agentic OS behavior.
- Target actions include:
  - tile windows
  - arrange windows
  - focus a chosen window
  - minimize/restore a chosen window
  - open apps from the Apps list
  - list current windows/apps for grounding

### 19.2 Integration method

- Implement via explicit inline tool calls (deterministic parser path).
- Add a WM action tool family (`wm_action`) in Agent1c tooling flow.
- Reuse existing `wm` methods; do not rewrite WM logic in agent layer.

### 19.3 Known WM hooks available now

- `tileVisibleWindows()`
- `arrangeVisibleWindows()`
- focus/minimize/restore through existing window state flow
- app/window creation:
  - `createFilesWindow()`
  - `createBrowserWindow()`
  - `createNotesWindow()`
  - `createTerminalWindow()`
  - `createThemesWindow()`
  - `createAppWindow(title, url)`

### 19.4 Shell relay future use (beyond current shell exec)

Besides `shell_exec`, relay is planned to also support:
- CORS-safe external fetch proxy endpoint (`/v1/http/fetch`) for:
  - HedgeyOS Browser access to CORS-blocked sites
  - future web/data tools that require server-side fetch behavior

### 19.5 Guardrails for future codex iterations

1. Always read `PHASE2_PLAN.md` before implementing WM action tooling.
2. Keep `agents.md` as long-form project memory and cross-check assumptions.
3. Preserve HedgeyOS-native WM behavior and visual language.
4. Keep execution deterministic with explicit tool tokens and TOOL_RESULT grounding.

### 19.6 Phase split refinement (2a / 2b)

Updated sequencing:
- Phase 2a first:
  - upgrade native HedgeyOS Browser to support relay fallback for CORS-blocked sites
  - keep native Browser as the visible browsing surface
- Phase 2b second:
  - let Hitomi use native Browser actions (open/focus browser, set URL, navigate)
  - then add broader WM action controls (`tile`, `arrange`, `focus`, `open app`, etc.)

Important product rule:
- If Hitomi "opens a website", the user should see it in native HedgeyOS Browser.
- Relay fetch is fallback/infrastructure, not the primary visible browsing UI.

### 19.7 Deferred setup UX bucket (Phase 2c)

Relay setup UX follow-up is intentionally deferred to Phase 2c:
- Add optional persistence instructions (Linux/Android) using user `systemd` service + optional `enable` on startup.
- Add clear uninstall flow in a separate tab/section with strong warning style (red caution) to prevent accidental execution.
- Keep macOS persistence guidance separate (launchd note), not mixed with Linux/Android systemd commands.

### 19.7a Phase 2c implementation notes

- Shell Relay main tabs are now: `Setup`, `Connect`, `Terminal`.
- `Terminal` is a Unix-like relay shell panel (prompt + append log transcript), replacing the old plain test box.
- Setup content now includes optional persistence and uninstall blocks:
  - Linux: `systemd --user` service flow (`daemon-reload`, `enable --now`).
  - macOS: launchd persistence note.
  - Android: Termux persistence note (not systemd).

### 19.8 Phase 2b document authority policy

For current 2b rollout, the shipped doc defaults are authoritative:
- `SOUL.md`
- `TOOLS.md`
- `heartbeat.md`

Behavior requirement:
- On refresh/reload, local edited versions of the three docs must be overwritten with deployed defaults.
- This is intentional to ensure coordinated prompt/tool behavior updates reach all users consistently.

---

## 20) Setup Hedgey onboarding runtime (Phase II)

Authoritative files:
- Plan: `PHASE_ONBOARDING_HEDGEY_PLAN.md`
- Content pack: `data/onboarding-hedgey-phase1.json`
- Runtime: `js/onboarding-hedgey.js`
- Thin integration: `js/agent1c.js`

### 20.1 Implementation rules

1. Reuse existing clippy/Hitomi UI components. Do not create a parallel assistant UI.
2. Setup guidance must be non-LLM and driven by phase JSON content.
3. Keep all setup copy in JSON; avoid hardcoding strings in runtime JS.
4. Add only pills/chips as new UI surface in setup mode.
5. If context is compacted, re-read the four authoritative files above before editing.

### 20.2 Trigger wiring implemented

- Vault flow:
  - `vault_initialized` on Create Vault success
  - `vault_skip_clicked` on skip path
- Provider flow:
  - `provider_section_opened_*` when provider card is selected
  - `provider_key_input_started` when user starts typing key/url
  - `provider_key_saved` on save actions
  - `provider_test_success` / `provider_test_error` on validation outcomes
  - `provider_ready_*` when provider is ready
  - `provider_model_selected` on model changes

### 20.3 UX behavior implemented

- Setup guide activates only while onboarding is incomplete.
- Setup links in bubble are clickable and routed to native HedgeyOS browser open path.
- Clippy/Hitomi is anchored to bottom when shown from hidden state so setup windows stay visible.
- Setup messages are deduped/cooldown-limited by onboarding runtime.
- Hitomi desktop icon now persists during onboarding even without AI key, so guide remains available.
- Name prelude flow:
  - if no stored user name, setup hedgehog asks name first before vault guidance.
  - Create Vault window is minimized initially so intro/name prompt is visually clear.
  - after name capture, Create Vault is restored/focused and normal setup flow continues.
- SOUL.md default now includes `User Name: ...` populated from local stored name.
- Mobile UX rule: Create Vault first position uses top-left anchoring for small screens.

### 20.4 Maintenance warning

If setup behavior looks wrong, check in this order:
1. `data/onboarding-hedgey-phase1.json` (source of truth)
2. `js/onboarding-hedgey.js` (state/trigger engine)
3. `js/agent1c.js` integration hooks in `wireSetupDom`, `wireProviderPreviewDom`, `initAgent1C`

---

## 21) Cross-Repo Delta Source

When working between `.me` and `.ai`, use these diff maps first:
- `LOCAL_VS_CLOUD_DIFF.md` (this repo's sovereign-first view)
- `../agent1c-ai.github.io/CLOUD_VS_LOCAL_DIFF.md` (cloud-first mirror)

Notes:
- Keep intentional divergence explicit and documented.
- If a capability exists in one repo but is hidden or unshown in the other (for example Telegram panel visibility), record it in both diff maps before changing runtime behavior.
