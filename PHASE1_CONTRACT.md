# Phase 1 Contract (No Drift)

Purpose:
- Lock exact implementation scope so future edits do not drift.

## Core Intent

Agent1c must let Hitomi execute local shell commands through a localhost relay that the user can install and run.
This must follow the same guided onboarding style as Ollama Setup.

## Non-Negotiable Requirements

1. Separate window:
- Must be a dedicated HedgeyOS-native window named `Shell Relay`.
- Must NOT be inside `Config`.

2. Setup UX style:
- Must match Ollama Setup method: guided, step-by-step, OS choice first, copy buttons on code blocks.
- Must include Linux, macOS, Android flows.
- Android flow includes Termux (prefer F-Droid) and browser CORS/private-network note.

3. Distribution/onboarding model:
- User is on `agent1c.me` in browser; repo files are not local by default.
- Setup commands must fetch/install relay onto user machine (do not assume local repo path).
- User must be able to start relay from copied shell commands shown in UI.

4. Implementation language:
- Relay implementation and setup flow for Phase 1 must be pure shell script + shell commands.
- No Python runtime dependency for relay.

5. Module boundary (mandatory):
- All relay logic must live in `js/agent1crelay.js`.
- Keep `js/agent1c.js` as thin integration only (wire-up/import/calls).
- Do not spread relay logic across unrelated files unless explicitly needed.

6. Security baseline:
- Bind relay to loopback only (`127.0.0.1`).
- CORS allowlist for `https://agent1c.me` (+ optional localhost dev origins).
- Optional token auth.
- Timeout and output truncation.
- Strong warning: run relay as non-sudo/non-root user.

7. Tooling contract:
- Keep inline tool syntax (no forced JSON mode).
- `shell_exec` only executes through explicit tool token.
- Result must be injected as `TOOL_RESULT shell_exec ...`.
- Never claim command success without tool result.

## Window/UI Contract

`Shell Relay` window contains:
- OS selector tabs/buttons.
- Step cards with copyable shell commands.
- Clear "Start Relay" step.
- "Test Relay" action and visible test status.
- Optional token + URL fields if needed by runtime wiring.

## Acceptance Criteria

1. Fresh user can open `Shell Relay` window and see full guided setup.
2. User can copy commands and start relay locally with shell only.
3. User can test relay successfully from Agent1c.
4. Hitomi can run `{{tool:shell_exec|command=...}}` and get deterministic result.
5. Existing chat/provider/loop behavior is not regressed.

## Delivery Gates

Gate A:
- `Shell Relay` window UX only (no runtime hook changes).

Gate B:
- Relay script + install/start shell commands finalized.

Gate C:
- Agent wiring (`shell_exec`, test flow, events) finalized.

Gate D:
- End-to-end validation and docs update in repo.
