# Phase: Setup Hedgey (Non-LLM Onboarding Guide)

## Goal
Build a non-LLM onboarding hedgehog guide that appears during setup and proactively helps users complete:
1. Create Vault screen
2. AI APIs screen

The guide is event-driven, state-aware, and limited to setup topics only.

## Product Intent
- Reduce first-run friction for non-technical users.
- Keep setup guidance contextual and proactive.
- Avoid requiring typed questions for obvious next steps.
- Preserve clear safety messaging, especially around skipping vault encryption.

## Scope
In scope:
- Setup Hedgey behavior on Create Vault + AI APIs only.
- Rule-based intent handling with grammar-style text variation.
- Event-triggered autonomous messages from UI actions.
- Clickable URLs in Setup Hedgey bubble.
- Topic pills above input, state-aware.

Out of scope:
- LLM calls for setup hedgehog.
- General chat capabilities during setup mode.
- Tool execution from setup hedgehog.

## UX Contract
- Setup Hedgey is active only while onboarding is incomplete.
- Setup Hedgey responds only to setup intents.
- Off-topic questions always receive tiny-brain fallback variants.
- Setup Hedgey should proactively message when key UI events are detected.
- Messages should be brief and friendly.

## Core Architecture
Implement a dedicated onboarding guide controller module:
- File: `js/onboarding-hedgey.js`
- Responsibilities:
  - Keep setup state machine.
  - Consume UI events and infer guidance events.
  - Render autonomous and user-triggered responses.
  - Provide pill suggestions per state.
  - Enforce cooldown and dedupe.

Component reuse mandate:
- Do **not** build a new hedgehog UI from scratch.
- Setup Hedgey must reuse the same existing Hitomi components:
  - floating hedgehog avatar
  - full dialogue bubble
  - compact/mini dialogue bubble
  - existing bubble positioning/snap logic
- New UI addition for setup mode is only:
  - state-aware pills/action chips above setup input

### Data Model
- `guideState`: current logical state (`vault_intro`, `vault_create`, etc)
- `guideContext`:
  - vault mode (encrypted/skip)
  - selected provider
  - provider key presence
  - provider validation status
  - model selected
- `seenHints`: set for dedupe keys
- `lastHintAt`: timestamp for cooldown
- `mode`: onboarding-only/non-LLM

## State Machine
States:
- `vault_intro`
- `vault_create`
- `vault_skip`
- `apis_intro`
- `apis_openai`
- `apis_anthropic`
- `apis_xai`
- `apis_zai`
- `apis_ollama`
- `apis_done_or_next`

Transitions driven by:
- button clicks
- provider expansion selection
- text input non-empty transitions
- save/test/model events
- onboarding completion flag

## Event-Driven Autonomous Guidance
### Trigger -> Message behavior
1. `vault_skip_clicked`
- "You chose to skip vault creation. Your API keys are not encrypted for now. Be careful."

2. `provider_section_opened(provider)`
- emits provider-specific key acquisition instruction.

3. `provider_key_input_started(provider)`
- "I see a key in <provider>. Next: save and test it."

4. `provider_saved(provider)`
- "Saved. Now test connection and pick a model."

5. `provider_test_success(provider)`
- "Great, <provider> is ready."

6. `provider_test_error(provider, code)`
- short, provider-specific troubleshooting.

7. `model_selected(provider, model)`
- "Model set to <model>. You are ready."

8. `ollama_setup_opened`
- "Follow setup steps, then return and test endpoint/model."

## URL and Link Behavior
- URLs shown in setup hedgehog bubble must be clickable.
- Links open via native HedgeyOS browser window (not external tab by default).
- Allowlist setup links:
  - OpenAI: `https://platform.openai.com/api-keys`
  - Anthropic: `https://platform.claude.com/settings/keys`
  - xAI: `https://console.x.ai`
  - z.ai: `https://platform.z.ai`
  - Ollama: local setup window action

## Topic Pills
Pills are shown above setup input and are state-aware.

Rules:
- Show max 5 pills.
- Use 3 primary action pills + 1-2 help pills.
- Keep `What next?` available in each state.
- Disable/hide pills that are invalid for current UI conditions.

Examples:
- `vault_intro`: Initialize Vault, Skip for now, Why passphrase?, Is this local-only?, What next?
- `apis_openai`: Where get OpenAI key?, I pasted key, Pick a model, Test failed, What next?

## Setup NLU (Non-LLM)
Implement keyword intent mapping:
- `vault_create`, `vault_skip`, `vault_risk`
- `provider_openai`, `provider_anthropic`, `provider_xai`, `provider_zai`, `provider_ollama`
- `model_help`, `validation_help`, `progress_next`, `locality`

If no setup intent matched:
- fallback from `fallback_offtopic` pool.

## Grammar Generation
Use templated phrase pools (Tracery-like style):
- greeting + action + reason + CTA
- random selection for variation
- short responses (1-3 lines)

Store grammar definitions in:
- `js/onboarding-hedgey-grammar.js` or `data/onboarding-hedgey-grammar.json`

## Delivery Phases
### Phase 1: Content Pack Generation
- Produce and lock onboarding content JSON first.
- JSON includes:
  - state map metadata
  - intent dictionary
  - trigger-to-message mappings
  - grammar phrase pools
  - pill sets per state
  - off-topic fallback variants
- No UI/runtime behavior changes in this phase.

### Phase 2: Runtime Wiring
- Implement `js/onboarding-hedgey.js` using Phase 1 JSON as the single source of truth.
- Reuse existing Hitomi/clippy components (full + compact bubbles, avatar, movement constraints).
- Add only pill/chip rendering and click handling.
- Add event wiring from Create Vault + AI APIs UI.
- Add cooldown/dedupe and off-topic guard logic.
- Ensure onboarding completion cleanly disables setup-only behavior.

### Phase 2 Status (Implemented)
- Runtime module added: `js/onboarding-hedgey.js`
- Source-of-truth JSON loaded at runtime: `data/onboarding-hedgey-phase1.json`
- Existing Hitomi/clippy UI reused (full + compact bubble + avatar + existing positioning logic).
- New UI addition implemented: setup action chips in clippy bubble.
- Onboarding wiring now connected to:
  - Create Vault init success (`vault_initialized`)
  - Create Vault skip (`vault_skip_clicked`)
  - AI provider section open events (`provider_section_opened_*`)
  - Provider key input started (`provider_key_input_started`)
  - Provider save/test success/error (`provider_key_saved`, `provider_test_success`, `provider_test_error`, `provider_ready_*`)
  - Provider model selection (`provider_model_selected`)
- Setup links in onboarding bubble are clickable and open through native HedgeyOS browser route.
- Onboarding guide activation is tied to onboarding completion state.
- Clippy spawn is forced to bottom when shown from hidden state to reduce overlap with setup windows.

### Phase 2 Runtime Notes
- Keep integration thin in `js/agent1c.js`; onboarding behavior should remain centralized in `js/onboarding-hedgey.js`.
- Do not duplicate setup copy in JS strings; update `data/onboarding-hedgey-phase1.json` instead.
- If context gets compacted, re-read this file plus:
  - `data/onboarding-hedgey-phase1.json`
  - `agents.md` (latest integration notes section)

## UI Integration Plan
1. Reuse existing clippy visual shell for consistency.
2. Add setup mode render path for bubble content:
- supports rich text + links + pills.
3. On Create Vault screen:
- Setup Hedgey auto-opens with `vault_intro`.
4. On AI APIs screen:
- Setup Hedgey tracks selected provider and reacts to expansion.

## Safety + Noise Controls
- Cooldown: one autonomous hint every ~2-4 seconds.
- Dedupe by (`state`, `trigger`, `provider`).
- Pause auto hints while user actively typing.
- Security warnings (unencrypted skip) bypass normal queue priority.

## Implementation Steps
1. Phase 1: finalize onboarding JSON content pack.
2. Add `onboarding-hedgey` runtime module and state machine skeleton.
3. Load and reference Phase 1 JSON (no hardcoded copy in runtime logic).
4. Wire events from Create Vault and AI APIs UI actions.
5. Add autonomous hint dispatcher with cooldown/dedupe.
6. Render clickable links in reused bubble renderer path.
7. Add state-aware pills/chips and click handlers.
8. Add off-topic guard behavior.
9. Run tests/manual checklist for all trigger paths.
10. Verify onboarding completion disables setup-only behavior.

## Testing Checklist
- Create vault path end-to-end with proactive hints.
- Skip vault path shows explicit risk warning.
- Provider expansion triggers correct provider instruction.
- Key typed event triggers "save and test" prompt.
- Save/test/model changes trigger expected next-step hints.
- Off-topic query always returns tiny-brain fallback.
- URLs are clickable and open in native browser window.
- Pills adapt to state and never show impossible actions.
- Cooldown/dedupe prevents spam.

## Rollout Notes
- Keep behind onboarding-only condition initially.
- Log guide triggers in Events for debugging.
- Keep copy strings centralized for easy tuning.

## Future Extensions (post-scope)
- Localized copy sets.
- Accessibility speech mode for setup hints.
- Guided checklists per provider.
- Light telemetry counters (local-only) for drop-off points.
