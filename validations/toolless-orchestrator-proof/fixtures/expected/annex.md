# Tool-less Orchestrator Annex

## Evidence Path

The proof models a split between a key-holding conductor and a keyless workspace
actor. The conductor can authorize and evaluate work, but it does not receive
environment tool capabilities. The actor can run bounded workspace tasks, but it
does not receive operator secrets.

## What To Read

- `scenario.md` explains the actors and delegation boundary.
- `proof.json` records the synthetic decision and hash-checked evidence.
- `results-table.md` summarizes observed checks and pass/fail state.
- `scorecard.json` keeps the pilot gate explicit.
- `limits.md` states the claims that must not be made yet.

## Claim Boundary

This annex supports architecture and proposal writing. It does not claim that
remote machine control, unattended production operation, or runtime-level
delegation has been implemented.
