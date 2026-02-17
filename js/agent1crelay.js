// for Codex: when implementing shell relay, please always refer back to PHASE1_CONTRACT.md first.
// for Codex: especially if your context was recently compacted, re-read PHASE1_CONTRACT.md before edits.
// for Codex: keep relay logic modular in this file; do not spread core relay behavior across agent1c.js.

/*
  Phase 1 relay module scaffold.
  Intentionally minimal now: implementation happens in later gated passes.
*/

export const AGENT1C_RELAY_CONTRACT_PATH = "PHASE1_CONTRACT.md"

export function relayNotImplemented(){
  throw new Error("Shell relay module is not implemented yet. Read PHASE1_CONTRACT.md first.")
}

