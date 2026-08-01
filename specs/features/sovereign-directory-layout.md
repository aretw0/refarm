# Sovereign directory layout

**Status:** Accepted and implemented at the host boundary  
**Scope:** SDK directory roles, Refarm operator home, workspace sidecars, future system nodes

## Contract

Filesystem ownership is selected by the host and consumed by semantic role. Generic packages and
plugins must not choose a product home, inspect `REFARM_HOME`, or concatenate `.refarm` themselves.

`@refarm.dev/root` exposes the pure `sovereignDirectories(absoluteRoot)` contract. It classifies a
host-selected root into `config`, `data`, `state`, `cache`, `runtime`, `distribution`, and `plugins`.
It performs no I/O and deliberately knows neither the Refarm brand nor XDG environment variables.

The Refarm app owns the adapter:

- operator root: `REFARM_HOME`, otherwise `~/.refarm`;
- active scoped root: explicit `REFARM_HOME`, otherwise an existing `<cwd>/.refarm`, otherwise the
  operator root;
- current compact layout: all roles remain below that root, preserving installed nodes;
- published device kit: `<operator-root>/dist/farm-client`, independent of a source checkout.
- node-wide workspace catalog: `<operator-root>/config.json#workspaces`, authored by
  `refarm workspace add`; physical paths remain device-local and never enter replicated config.

Workspace-relative `.refarm` paths remain valid when the data belongs to that workspace. They are
not a substitute for operator state, and commands must make the selected scope observable.

## Portability

The semantic roles are the stable SDK. Their physical placement is a host policy. A future XDG,
Termux, container, or system-service adapter may map roles to different roots without changing a
plugin or generic package. Such a profile must be explicit and migrated transactionally; silently
switching existing `~/.refarm` nodes to XDG paths is forbidden.

System-wide `/etc/refarm`, `/var/lib/refarm`, and `/run/refarm` placement belongs only to a future
system-service profile with an administrator-owned identity. A `systemd --user` node stays
user-owned and requires no root privileges.

## Enforcement

- Generic packages accept paths or storage adapters from their host.
- Refarm code resolves operator paths through `utils/refarm-home.ts`.
- New direct `homedir() + ".refarm"` constructions outside that adapter are architecture failures.
- State inspection reports the declared and served physical roots; a running process is not enough
  to declare distribution readiness.
