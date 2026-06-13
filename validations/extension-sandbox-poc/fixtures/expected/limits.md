# Extension Sandbox PoC Limits

Scope: synthetic local validation only. No real plugins, services, institutional data, or secrets are used.

## Do Not Claim

- Real WebAssembly execution inside the synthetic sandbox report.
- Production plugin governance.
- Security certification or complete isolation guarantees.
- Performance readiness for a real plugin host.

## Adoption Risks

- Capability grants may become too broad without operator review.
- Real WASM runtime failures may differ from the simulated lifecycle.
- Quarantine, recovery, and plugin update flows are not covered here.
- Host performance and resource isolation still need dedicated tests.

## Promotion Path

Promote claims only after the real WASM/browser lifecycle validation, install/deny/quarantine/review commands, and host performance checks produce their own evidence.
