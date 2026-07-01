# Tool-less Orchestrator Limits

This proof supports careful architecture and implementation writing, not a
production claim.

## Current Claims

- A key-holding conductor can be modeled without environment tool capabilities.
- A keyless actor can return bounded evidence without receiving operator keys.
- Completion can require source hash checks and recoverable raw evidence.

## Do Not Claim

- The production runtime is fully split this way.
- Unattended agent operation is safe.
- Remote workspace delegation is implemented.
- A package or public API has been extracted for this proof.

## Promotion Criteria

- A runtime conductor uses the same separation in dogfood.
- Worker/session contracts carry the same request/evidence boundary.
- Environment ceilings enforce the actor bounds before execution.
- A second consumer consumes the manifest without importing proof internals.
