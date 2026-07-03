# Spec: Operator State Backup & Restore (Daily-Driver Parity — "Recover from failure")

**Status:** DRAFT — for operator review; no code moved yet
**Authors:** Claude (draft from 2026-07-03 audit), pending Arthur Silva review
**Date:** 2026-07-03
**Related:** `docs/DAILY_DRIVER_PARITY.md` (Minimum Daily Loop row "Recover from failure"),
`specs/ADRs/ADR-076-silo-storage-identity-closure-separation.md` (0600/0700 hardening),
`specs/ADRs/ADR-077-silo-protected-secret-envelope.md`,
`specs/ADRs/ADR-080-vault-seed-ready-handoff-pipeline.md` (manifest convention),
`packages/storage-sqlite`, `packages/silo`

---

## Context

The parity row requires: *"restore from backup without graph corruption or lost tasks"*. Unlike
the reminders row, here the gap is real end to end: **no `refarm backup` surface exists and no
doc names what must be captured**. The adjacent row "Preserve memory" already proves that graph
stores and task/session handoffs survive a daemon restart — this spec extends survival from
*restart* to *loss of state files*.

### Durable state inventory (verified 2026-07-03)

| State | Where | Backed up today by |
| --- | --- | --- |
| Project blocks (handoff, automations, decisions, phases…) | `.project/` (tracked) | git — already durable |
| Runtime state: sessions, tasks, task-results, task-logs, streams, identity, local config | `.refarm/` (untracked) | **nothing** |
| Credentials: identity + namespaced secret envelopes | silo home — `$SILO_HOME` \|\| refarm home \|\| `~/.silo` (`packages/silo/src/index.js:357-360`) | **nothing** |
| Graph stores (node side) | Loro/SQLite files under local data dirs | **nothing** |
| Graph stores (browser side) | OPFS `/opfs/refarm-<namespace>.db` (`packages/storage-sqlite/src/index.ts:80`) | **nothing** (browser-owned) |
| Handoff packets | `.refarm/handoff/**` (manifest-bearing dirs are the rollback chain, ADR-080) | reproducible via `release:vault-seed:handoff` |

## Decisions

1. **Two tiers, ship Tier 1 first.**
   - **Tier 1 — operator kit:** silo home (envelopes copied as-is), `.refarm/identity.json`,
     `.refarm/config.json`, `.refarm/sessions`, `.refarm/tasks`, `.refarm/task-results`.
     Cheap file-level copy; covers "lost tasks" and "locked out" failure classes.
   - **Tier 2 — graph:** per-namespace SQLite snapshot taken through a WAL-checkpointed copy (or
     the SQLite backup API), never a live-file naive copy. OPFS (browser) export is explicitly
     deferred to an `apps/me` surface — the node-side snapshot is the parity target.
2. **The backup is a packet with a manifest.** A backup is a dated directory
   (`refarm-backup-<timestamp>/`) whose `manifest.json` carries `schemaVersion`, `generatedAt`,
   `sourceGitSha`, and per-file `sha256` — the same self-describing convention ADR-080 imposed on
   handoff packets, for the same reason: **a state copy that cannot be verified is not a backup.**
   `restore` refuses a packet whose hashes do not match.
3. **Secrets stay sealed.** Envelopes are copied byte-for-byte with their `0600`/`0700` modes
   preserved (ADR-076); backup never decrypts, re-encrypts, or normalizes them, and the manifest
   records only hashes — honesty consistent with `local-plaintext-v1` (ADR-077). The backup
   directory itself is created `0700`.
4. **Restore is preflight-gated.** `refarm backup restore <dir> --json` first diffs packet vs
   live state and reports what would be overwritten; restoring over *newer* live state requires
   `--force`. A restore writes to a staging dir and swaps atomically per file group, so a failed
   restore cannot leave hybrid state.
5. **Command surface:** `refarm backup create [--tier graph] --json`,
   `refarm backup verify <dir> --json`, `refarm backup restore <dir> [--force] --json` — JSON
   envelopes with `ok`/`nextCommand`/`nextCommands` like every operator command.

## Proof (parity row signal)

1. `backup create` → delete a session file, a task result, and one silo secret → `backup restore`
   → `refarm resume --json` and `refarm check --next-action --json` return the pre-deletion
   state; no task lost.
2. Tier 2: snapshot → corrupt the live SQLite file → restore → graph reopens and a
   previously-stored node reads back intact (extends the existing restart proof).
3. `backup verify` fails loudly on a tampered packet (flip one byte → hash mismatch → `ok: false`).

## Non-goals

- Scheduled/automatic backups — composes later with the reminders execution spec
  (`2026-07-03-local-reminders-execution.md`) once farmhand owns a tick.
- Cloud/off-machine replication — that is `sync-contract-v1` / distribution-evidence territory
  (ADR-075 boundary), not this row.
- Browser OPFS export/import UX.

## Open questions for review

- Backup destination default: inside the workspace (`.refarm/backups/`, excluded from git) vs
  outside (`~/.refarm-backups/`) — outside survives a repo wipe, which is the very failure class
  Tier 1 targets; leaning outside.
- Whether `identity.json` restore should require an explicit extra flag (restoring an identity is
  more consequential than restoring tasks).
