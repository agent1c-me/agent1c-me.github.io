# Agent1c.me vs Agent1c.ai (Current Delta Map)

This document tracks practical differences between:

- Sovereign repo: `agent1c-me.github.io` (`agent1c.me`)
- Cloud repo: `agent1c-ai.github.io` (`agent1c.ai`)

Goal: preserve sovereign behavior while making cloud divergence explicit.

## 1) Product mode

- `agent1c.me`: sovereign local-first BYOK runtime.
- `agent1c.ai`: hosted/authenticated cloud runtime path.

## 2) Onboarding

- `.me`:
  - setup hedgehog + user-name capture
  - create-vault / skip-for-now
  - key-driven setup progression
- `.ai`:
  - preload + intro
  - cloud sign-in gate
  - no vault requirement in core cloud path

## 3) Key management

- `.me`: users configure provider keys directly (local storage/vault model).
- `.ai`: managed cloud provider path; provider secret is server-side.

## 4) Telegram surface

- `.me`: Telegram API window is a normal first-class runtime panel.
- `.ai`: Telegram logic exists in code, but cloud workspace currently does not surface Telegram panel by default.

This is currently the clearest fork-drift issue to resolve deliberately.

## 5) Credits/quota

- `.me`: no cloud credits model.
- `.ai`: credits window + cloud quota semantics.

## 6) Editable docs windows

- Both repos keep editable `SOUL.md`, `TOOLS.md`, `heartbeat.md`.
- `.me` remains canonical for sovereign behavior tuning.
- `.ai` includes cloud session/system-message overlays.

## 7) Relay direction

- `.me`: local shell relay and local sovereignty are core.
- `.ai`: shell relay remains present, but cloud architecture introduces managed relays and auth coupling.

## 8) Change-management rule for parity

When a feature is changed in either repo:

1. Mark it as `shared`, `.me-only`, or `.ai-only`.
2. Update both this file and `../agent1c-ai.github.io/CLOUD_VS_LOCAL_DIFF.md`.
3. If behavior differs unintentionally, tag it as `drift` until fixed.
