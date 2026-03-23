# @refarm.dev/silo

Silo is Refarm's context and secret provisioner. It manages tokens, identity metadata, and environment variables, acting as the local "Vault" for the sovereign citizen.

## Features

- **Context Provisioning**: Resolve and inject secrets into specific targets (e.g. GitHub Actions).
- **Master Key Management**: Bootstrap and protect the Refarm master identity key.
- **Persistence**: Secure storage of non-sensitive identity metadata.

See [ROADMAP.md](./ROADMAP.md) for the path to OPAQUE-based encryption and hardware isolation.
