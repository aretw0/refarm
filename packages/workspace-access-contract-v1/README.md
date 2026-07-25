# @refarm.dev/workspace-access-contract-v1

`workspace-access:v1` — the generic authorization block for a sovereign,
multi-tenant Refarm node: **who may act in which workspace, and the storage
namespace each workspace maps to.**

It sits on top of authentication. `@refarm.dev/identity-contract-v1`'s
`deriveFromSession` answers *"who are you"* (a device credential → an identity);
this contract answers *"which workspace may that identity act in, and where does
its data live"*. One policy, enforced by the daemon's auth gate and read by any
surface (enrollment, an admin view, the hub's workspace picker).

## The model

Two workspace kinds — a **personal** space (one person's, isolated) and a
**collective** space (shared by several). An identity's `Membership` lists the
workspaces it may select; a request picks one (constrained to that list) and the
gate resolves it to the workspace's policy-defined `namespace`.

```ts
import { resolveAccess, validatePolicy } from "@refarm.dev/workspace-access-contract-v1";

const policy = {
  workspaces: [
    { id: "personal-arthur", kind: "personal",   namespace: "personal-arthur" },
    { id: "collective-casa", kind: "collective", namespace: "collective-casa" },
  ],
  memberships: [{ identity: "id-arthur", workspaces: ["personal-arthur", "collective-casa"] }],
};

resolveAccess(policy, "id-arthur", "collective-casa");
// → { ok: true, workspace: { id: "collective-casa", namespace: "collective-casa", … } }
resolveAccess(policy, "id-stranger", "collective-casa");
// → { ok: false, reason: "unknown-identity" }
```

## Safety invariants

- A **client never supplies a namespace** — only a workspace id, used to look up
  an allowed workspace. The namespace is always the policy's.
- `validatePolicy` rejects unsafe namespaces (a DB-path injection like
  `../../evil` or `:memory:`) and dangling memberships — enforce it at load time.
- Everything is PURE (no I/O), so the Rust gate implements the SAME rules this
  TS reference resolver does. One contract, many surfaces, no drift.

See `docs/superpowers/specs/2026-07-24-sovereign-auth-workspaces-design.md`.
