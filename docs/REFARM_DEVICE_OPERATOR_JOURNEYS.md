# Refarm device operator journeys

Status: maintained acceptance paths for Refarm-owned device surfaces.

This is the smallest canonical bank of operational journeys for using a Refarm node from another
device. It describes Refarm capabilities only. A workspace may declare operations that appear on
these surfaces, but its product vocabulary, repositories, paths, policies, and private data do not
belong here.

Network transport is an operator choice. Replace `<farm-host>` with an address already reachable by
the device and `<device-label>` with a name the operator recognises. Refarm does not require a
particular VPN, ingress provider, DNS service, or topology.

## Maturity ledger

| Journey | Current maturity | Human proof still required | Automated evidence |
|---|---|---|---|
| Termux bootstrap and operation | minimally usable | one install and operation roundtrip on the target Android device | `pnpm --filter @refarm.dev/farm-client run test` |
| PWA install and personal shell | minimally usable | install from the target browser and reopen from the home screen | `pnpm --filter @refarm.me/app run smoke:pwa` |
| PWA remote sync | implemented and smoke-covered | one roundtrip over the operator's chosen device network | `pnpm --filter @refarm.me/app run smoke:remote-device` |
| PWA operational parity with Termux | partial | operation catalog and pending prompts must become one coherent primary-app journey | `/attend` integration tests plus the Termux wire tests |

“Minimally usable” means that the checked path performs useful work today. It does not mean every
Termux affordance is already present in the PWA.

## Journey 1 — Bootstrap and operate from Termux

### Preconditions

- The node passes `refarm check --next-action --json`.
- Node 22 or newer is installed on the device.
- `<farm-host>` is reachable through a network rail chosen by the operator.
- Refarm can reach the operator-selected network rail from this node.

### Prepare the node

```bash
refarm check --next-action --json
refarm surface add web
refarm surface add sidecar-http
refarm surface add daemon-ws
refarm auth enroll <device-label>
refarm dist publish --host <farm-host>
refarm web serve .refarm/dist/farm-client --port 4321
```

`auth enroll` prints the credential once. Transfer it through an operator-approved secret channel;
do not paste it into documentation, logs, issue trackers, or committed configuration.

### Bootstrap the device

```bash
curl -fsSL http://<farm-host>:4321/install.mjs | node --input-type=module -
farm-auth set
farm-auth status
farm-hello <farm-host>
```

Expected observation: `farm-hello` reports that the sync and sidecar endpoints are reachable. A
failure must name the unavailable endpoint or the authentication problem; silence is not success.

### Operate

```bash
farm-ask "report the node status"
farm-start
farm-start "<operation-id>"
farm-start --status <run-id>
farm-attend --list
farm-attend
```

- `farm-ask` submits work and prints its result and usage when the runtime reports it.
- `farm-start` lists only operations declared remotely invocable by the node; it is not a shell.
  A start returns an opaque run id, and `--status` reports `running`, `succeeded`, `failed`, or
  `cancelled`. Stdout never crosses this control surface. An operation that explicitly declares
  `result: "operation-result.v1"` may return only the contract's bounded, redacted summary,
  metrics, and findings. The node retains only the current/most recent run, so this is lifecycle
  and result introspection rather than an unbounded log.
- Remote spawning is fail-closed: the node must declare `spawnEnv.path` (and normally
  `spawnEnv.home`) in its sovereign config. An absent search path is a configuration migration to
  author on the node, never permission to inherit the daemon's ambient environment. Use the
  recorded list-authoring surface rather than editing JSON:

  ```bash
  refarm config spawn-env set <absolute-bin-dir>... --home <absolute-home-dir>
  refarm config spawn-env --json
  ```

  The declared order is the executable search order. `refarm config history` exposes the change
  and its executable undo.
- `farm-attend` answers a pending operator prompt using the shared prompt contract.

### Re-observe and undo

```bash
farm-hello <farm-host>
farm-auth remove
refarm auth revoke <device-label>
```

Run `auth revoke` on the node. After revocation, the former credential must no longer authorize the
device. `farm-auth` keeps the credential outside the updateable kit in
`~/.refarm/credentials/device-token` (directory mode `0700`, file mode `0600`), so `farm-update`
cannot overwrite it. `FARM_TOKEN` remains the higher-precedence override for one command or one
shell, and `FARM_TOKEN_FILE` may point automation at another private file; neither needs to enter a
shell profile. Stopping a temporary distribution server is a separate process/supervisor operation.

### Proof plan

```bash
pnpm --filter @refarm.dev/farm-client run test
pnpm --filter @refarm.dev/farm-client pack --pack-destination /tmp/refarm-farm-client-pack
```

The package suite covers bootstrap, integrity update, discovery, authentication, asking, declared
operation initiation, pending-prompt attendance, and the zero-runtime-dependency boundary. The
tarball inspection proves the files that a clean device actually receives.

## Journey 2 — Install and operate the PWA

### Preconditions

- The node runtime is ready.
- `apps/me` is built.
- The browser reaches a secure origin chosen by the operator. A remote PWA requires HTTPS for the
  service worker, Web Crypto, OPFS, and WASM paths.
- The Refarm web surface is declared for the intended network reach and remains device-gated.

### Prepare and serve the app

```bash
pnpm --filter @refarm.me/app run build
refarm cert issue --json
refarm web serve apps/me/dist --port 4321 --tls-cert <cert.pem> --tls-key <key.pem> --json
```

Use the `pageUrl` printed by `web serve`. Certificate trust and network exposure are distinct
operator decisions; neither is implied by building the PWA.

### Install and operate

1. Open `pageUrl` on the target device.
2. Complete the device verification offered by the Refarm surface.
3. Confirm that the personal surface renders and sync reaches `connected` or `snapshot-applied`.
4. Submit and cancel one chat turn.
5. Install the PWA using the browser's “install” or “add to home screen” action.
6. Reopen it from the home screen.
7. Visit `/attend` only when a pending node prompt must be answered.

Expected observation: the installed shell reopens, reports sync state, and remains renderable after
its offline shell has been seeded. Offline shell availability does not claim that remote work can
execute while the node is unreachable.

### Re-observe and undo

- Reopen the installed app and confirm the current sync status instead of trusting the install UI.
- Revoke the device credential on the node with `refarm auth revoke <device-label>`.
- Remove the PWA using the browser or operating system's normal application-management surface.
- Stop or uninstall the declared `web-serve` process separately if it was created only for this
  acceptance run.

### Proof plan

```bash
pnpm --filter @refarm.me/app run smoke:pwa
pnpm --filter @refarm.me/app run smoke:offline-roundtrip
pnpm --filter @refarm.me/app run smoke:real-daemon-roundtrip
pnpm --filter @refarm.me/app run smoke:remote-device
```

These proofs cover the installable offline shell, offline mutation and reconnect, observation
through a real daemon, and remote HTTPS/sync/service-worker composition. They do not yet prove that
the primary PWA presents the complete declared-operation journey already available in Termux.

## Completion rule

A journey is complete only when:

1. its automated proof passes;
2. its human-only observation has been performed on the target device;
3. the result was re-observed after restart/reopen where applicable;
4. credentials, addresses, and workspace-specific vocabulary were not committed as evidence.

When a new device surface appears, extend this document only if it creates a genuinely distinct
operator journey. Adapter-specific implementation details belong beside the adapter, and design
decisions belong in `specs/features` or an ADR.
