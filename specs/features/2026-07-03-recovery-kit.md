# Spec: Recovery Kit (Daily-Driver Parity)

**Status:** DRAFT - operator command, not a distributed primitive
**Date:** 2026-07-03
**Related:** `docs/DAILY_DRIVER_PARITY.md`,
`specs/ADRs/ADR-076-silo-storage-identity-closure-separation.md`,
`specs/ADRs/ADR-077-silo-protected-secret-envelope.md`,
`specs/ADRs/ADR-080-vault-seed-ready-handoff-pipeline.md`,
`packages/storage-sqlite`, `packages/silo`

## Purpose

The daily-driver row asks for one thing: recover from local state loss without
lost tasks or graph corruption. This is an operator recovery command composed
from existing primitives. It is not a new package, schema contract, or
`vault-seed-ready` distribution surface.

## Boundary

`refarm backup` creates and restores a local recovery packet:

- packet manifest convention from ADR-080;
- sealed Silo files copied as bytes, never decrypted or normalized;
- `.refarm` operator state copied as files;
- graph snapshots only through storage-owned backup APIs, not naive live DB
  copies.

The command may reuse helpers later, but the first release should stay small
and live in the operator CLI.

## Scope

Ship Tier 1 first:

- `.refarm/identity.json`
- `.refarm/config.json`
- `.refarm/sessions`
- `.refarm/tasks`
- `.refarm/task-results`
- Silo home metadata and sealed envelopes, preserving restrictive modes

Defer Tier 2:

- node-side SQLite/Loro graph snapshots;
- browser OPFS export/import;
- scheduled backups;
- cloud or off-machine replication.

## Command Shape

```bash
refarm backup create --json
refarm backup verify <dir> --json
refarm backup restore <dir> --json
refarm backup restore <dir> --force --json
```

Every command returns the normal operator JSON envelope: `ok`, `nextCommand`,
and `nextCommands`.

`create` writes a dated `refarm-backup-<timestamp>/` directory with
`manifest.json`, `generatedAt`, `sourceGitSha`, file paths, modes, sizes, and
`sha256` hashes. The backup directory is created `0700`.

`verify` refuses a packet when any recorded file hash, size, required path, or
mode check fails.

`restore` preflights the live state that would be overwritten. Restoring over
newer live state requires `--force`. Restore writes through staging paths before
replacing a file group.

## Proof

Minimum local signal:

1. create a backup;
2. remove one session file, one task result, and one sealed Silo entry in an
   isolated fixture;
3. restore the packet;
4. `refarm resume --json` and `refarm check --next-action --json` see the
   recovered state;
5. tampering with one packet byte makes `refarm backup verify` return
   `ok: false`.

The graph corruption row stays open until Tier 2 adds a storage-owned snapshot
proof.
