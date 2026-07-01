# @refarm.dev/config

Config provides sovereign configuration management for Refarm distros and plugins. It manages hierarchy, overrides, and persistence of system-level settings.

## Features

- **Hierarchical Configuration**: Support for Repo-level, User-level, and Graph-level overrides.
- **Type-Safe Access**: Integration with TypeScript for validated config access.
- **Plugin Configuration**: Standardized way for plugins to request and read their own settings.
- **Configuration as a Node**: `@refarm.dev/config/config-node` turns loaded config into a redacted,
  hash-addressed `refarm.config.node.v1` envelope for graph handoff and policy review.

See [ROADMAP.md](./ROADMAP.md) for the path to "Configuration as a Node".
