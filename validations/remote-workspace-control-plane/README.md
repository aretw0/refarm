# Remote Workspace Control Plane Proof

This validation is the first proof for ADR-074. It models one enrolled remote
workspace node and one bounded read-only effort without exposing a real remote
transport or extracting a public package.

The fixture deliberately uses `schema: "refarm.remote-workspace-node.proof.v1"`
and loopback transport. It proves the shape of:

- node readiness and refused operations;
- policy-before-dispatch;
- `process-handoff` tokenized command evidence;
- stream-shaped output;
- cancellation states;
- artifact/audit evidence.

Run:

```bash
pnpm run remote-workspace-control:poc:test
```

Non-goals:

- no Tailscale, Telegram, Matrix, PWA, Android, or SSH adapter;
- no public sidecar exposure;
- no generic remote shell;
- no package extraction.
