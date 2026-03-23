# @refarm.dev/sync-loro

Sync-Loro is Refarm's core synchronization engine, leveraging the Loro CRDT library to ensure high-performance, conflict-free data replication between the browser and the native microkernel.

## Features

- **Binary Interop**: Seamless delta replication between JavaScript and Rust.
- **CQRS Projector**: Efficiently materializes CRDT states into relational SQLite tables.
- **Offline-First**: Guaranteed convergence even after extended periods of isolation.

See [ROADMAP.md](./ROADMAP.md) for the path to peer-to-peer sync and history pruning.
