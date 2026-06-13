# External Consumer Calibration

This playbook keeps Refarm useful on non-Refarm work without turning every
consumer repository into a Refarm implementation detail.

## Repository Classes

| Class | Examples | Refarm may write? | Purpose |
| --- | --- | ---: | --- |
| Refarm core | this monorepo | Yes | Own shared primitives, CLI contracts, runtime behavior, and docs. |
| Writable consumer | `agents-lab`, `vault-seed` | Only when explicitly scoped | Prove that primitives work outside Refarm and keep repo-local policy there. |
| Read-only evidence vault | work mirrors, submission drafts, archived repos | No | Provide requirements, examples, and failure evidence for Refarm primitives. |

Read-only evidence must not receive `.refarm/config.json`, generated reports,
commits, or formatting changes. Treat it as input for calibration only.

## Read-Only Loop

Use the agent templates instead of ad hoc commands:

```bash
refarm agent finish --templates --json
```

For a read-only repository, the allowed template families are:

- `external-consumer-resume-json`
- `external-consumer-check-json`
- `external-consumer-health-policy-json`
- `external-consumer-health-suggest-policy-json`

`external-consumer-health-suggest-policy-json` may inspect and suggest a policy,
but it must not write `.refarm/config.json`. Do not run
`refarm health --apply-suggested-policy --json` in a read-only mirror.

## Promotion Rule

When read-only evidence exposes a gap, promote the fix to the lowest durable
home:

| Evidence | Durable home |
| --- | --- |
| Repeated handoff ambiguity | `packages/cli` or `apps/refarm` JSON contract |
| Workspace health noise | `@refarm.dev/health` policy primitive or consumer config |
| Large-file or complexity pressure | `@refarm.dev/health` complexity auditor and repo policy |
| Plugin/capability/revocation gap | plugin manifest, Barn, Tractor, or runtime descriptor docs |
| Vault/knowledge workflow gap | shared import/metadata primitives or `vault-seed` policy |

For the current `vault-seed` boundary and why its `dgk` CLI should remain a
consumer/product cockpit instead of being absorbed by `apps/refarm`, see
[`VAULT_SEED_CONVERGENCE.md`](VAULT_SEED_CONVERGENCE.md).

Only write to a consumer repository after the operator has named it as writable
for the current slice. Otherwise, record the durable fix in Refarm or leave a
reviewed candidate for the operator to apply elsewhere.

## Practical Stop Condition

A calibration slice is complete when:

- the read-only repository was not modified;
- the observed gap is either documented, fixed in Refarm, or explicitly deferred;
- `refarm resume --json` and `refarm check --next-action --json` are clean in
  the Refarm workspace;
- any writable consumer change, when one exists, has its own atomic commit.
