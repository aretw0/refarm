# Tool-less Orchestrator Scenario

A key-holding conductor needs to decide whether delegated work is complete
without also owning the environment tools that inspect a workspace.

The proof splits the actors:

- the conductor may hold operator keys, delegates work, verifies evidence, and
  decides;
- the workspace actor has bounded environment tools, but is keyless;
- the delegation request carries capability names, source refs, and policy, not
  secret material;
- the actor returns fenced evidence with a recoverable raw-evidence reference;
- the conductor completes only after source hash and fence checks pass.

This is a proof-local validation. It does not mutate `pi-agent`, `farmhand`, or
any app policy.
