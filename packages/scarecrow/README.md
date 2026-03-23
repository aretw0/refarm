# @refarm.dev/scarecrow (O Espantalho)

Scarecrow is Refarm's security and validation manager. It enforces policies, validates plugin signatures, and protects the Sovereign Graph from invalid or malicious nodes.

## Role

Where `Fence` handles runtime isolation, Scarecrow handles the **Policy** layer. It makes the decisions about what is allowed to enter the farm based on authoritive truth.

## Features

- **Policy Enforcement**: Standardized validation rules for JSON-LD nodes.
- **Signature Verification**: (Integration with Heartwood) for plugin author authentication.
- **Threat Detection**: identifying known malicious patterns in plugin manifests.

See [ROADMAP.md](./ROADMAP.md) for the path to the "Sovereign Web Guardian".
