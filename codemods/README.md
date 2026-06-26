# Codemod Registry

This directory records codemod-shaped work before Refarm adds any codemod
runtime, package, hosted registry, or MCP surface.

The contract is intentionally small:

- `registry.json` is the source of truth.
- `registry.test.mjs` validates the entry shape and the promotion gate.
- Entries start as `candidate` until a specific transform needs execution.

## Entry Schema

Each entry has:

- `id`: stable identifier for the transform.
- `status`: `candidate`, `ready`, `implemented`, or `retired`.
- `ownerSurface`: the surface being changed, such as `package`, `docs`,
  `consumer repo`, or `cross-repo`.
- `tool`: `generator`, `ast-grep`, `ts-morph`, `codemod`, or
  `manual-reviewed`.
- `inputs`: source paths, patterns, or contracts the transform reads.
- `fixtures`: before/after fixtures. Required for `ready` and `implemented`.
- `dryRunCommand`: deterministic command that reports planned edits without
  writing. Required for `ready` and `implemented`.
- `verificationGate`: the command or observable proof that the transform is
  correct.
- `rollbackNote`: how to revert the change or constrain blast radius.

## Promotion Rule

Promotion from `candidate` to `ready` happens per entry, in the same change that
adds its safety rails:

1. Add before/after fixtures for the transform.
2. Pick the smallest structure-preserving tool that fits the input.
3. Add a deterministic dry-run command.
4. Record the verification gate and rollback path.
5. Run `node --test codemods/registry.test.mjs`.

After the fixture test, dry-run output, target verification, and rollback proof
pass, the entry can move from `ready` to `implemented`.

Entries can move directly to `retired` when the underlying work is completed by a
smaller manual change or generator-first lane before codemod promotion, or when
the transform is no longer needed.

## Ready Entries

`ds-token-adoption` is the first `ready` entry. It is intentionally narrow:

- prepends the Refarm DS token/theme/component CSS imports when absent;
- removes only semantic `ds-tokens:v1` custom-property declarations from
  `:root` / `[data-vault-marimo-theme]` blocks;
- preserves consumer-local non-semantic variables such as `--gdg-*` as fallback
  surface state;
- prints transformed CSS by default, so a consumer can review the dry run before
  applying it with `--write`.

Dry run:

```bash
node codemods/ds-token-adoption.mjs --input vault-seed/.site/styles/marimo-vault.css
```

## Manual-Reviewed Line

`npm-scope-doc-sweep` stays `manual-reviewed` unless it becomes a recurring
transform with fixtures. It must use a reviewed replace list, not a blind owner
handle rewrite, because docs can mention accounts, migration history, examples,
and publish targets with different meanings.

## Non-Goals

- No hosted registry until at least two entries are `ready`.
- No new package until at least two entries are `ready`.
- No MCP surface in this slice.
- No broad rewrite without fixtures, dry-run output, verification, and rollback
  notes.
- No codemods for ADR decisions or speculative research.
