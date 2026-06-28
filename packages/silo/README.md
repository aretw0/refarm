# @refarm.dev/silo

Silo is a context and secret provisioner. It manages provider tokens, identity
metadata, and namespaced secrets without requiring consumer CLIs to adopt Refarm
environment variable names.

## Features

- **Context Provisioning**: Resolve and inject provider secrets into specific targets (e.g. GitHub Actions).
- **Master Key Management**: Bootstrap and protect local identity key material.
- **Persistence**: Secure storage of non-sensitive identity metadata.

`SiloCore.resolve()` and `SiloCore.provision("object")` return provider-native
keys such as `GITHUB_TOKEN` and `CLOUDFLARE_API_TOKEN`. Use `SILO_HOME` to choose
the default local storage directory, or pass `storagePath` explicitly. Existing
Refarm operators can still rely on `REFARM_HOME` as the storage fallback when
`SILO_HOME` is unset.

See [ROADMAP.md](./ROADMAP.md) for the path to OPAQUE-based encryption and hardware isolation.
