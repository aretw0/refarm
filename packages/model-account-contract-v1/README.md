# @refarm.dev/model-account-contract-v1

The `model-account:v1` contract: the types, the pure resolver, and the descriptor catalog that let
one model provider hold many credentials on one node. **This package makes no provider traffic.** It
performs no network request, no OAuth, and no login; it reads nothing and writes nothing. Every
function is pure, and every input is passed in.

## Why it exists

A provider is a protocol and a billing product. A model account is one credential-bearing identity
on this node. Refarm used to collapse the two, keying credentials by provider alone in a map with
one slot per key. Measured against a real credential store on 2026-08-12: authenticating a second
GitHub Copilot account overwrote the first, with no error, no warning, and no copy kept.

An operator holding a personal and a corporate account of the same provider could not keep both.
That is not a difficult configuration under the old shape — it is an impossible one.

## What it provides

| export | what it does |
| --- | --- |
| `newCredentialId(seed)` | An opaque, stable, node-local id. Never derived from an alias, so a rename cannot move it. |
| `resolveModelAccount(input)` | Which account a dispatch spends, or a refusal. Takes no working directory, no clock and no environment. |
| `reconcileCatalog(descriptors, secretRefs)` | Matches descriptors against the secrets that exist, and reports the mismatches instead of deleting them. |
| `renameAlias(catalog, id, alias)` | Changes the alias and nothing else. |
| `readLegacyCredentials(tokens)` | Reads the old flat token layout as accounts. Additive; it rewrites nothing. |

## The refusal is the feature

With two eligible credentials and nothing saying which to use, `resolveModelAccount` returns
`model_credential_ambiguous` and names safe candidates. It does not pick the newest, the last login,
or the first key. Guessing here spends the wrong quota on the wrong work, silently, which is the
outcome the whole contract exists to make impossible.

## Aliases mean nothing

`blue`, `personal`, `client-x` and `account-03` have exactly the same contract meaning: none.
Nothing in this package branches on an alias's text. Aliases are unique only within a provider, so
`github-copilot/blue` and `kimi-api/blue` may both exist.

## Governing design

[`docs/superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md`](../../docs/superpowers/specs/2026-08-06-account-aware-copilot-kimi-providers-design.md)
— decisions D1 (provider, account and binding are separate identities), D2 (secrets belong to the
node; workspaces carry only bindings) and D3 (resolution is explicit, surface-neutral and
fail-closed).
