# Codemod Registry

This directory records codemod-shaped work before Refarm promotes it into a
codemod runtime, package, hosted registry, or MCP surface.

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

`ds-token-adoption` is intentionally narrow:

- prepends the Refarm DS token/theme/component CSS imports when absent;
- removes only semantic `ds-tokens:v1` custom-property declarations from
  `:root` / `[data-vault-marimo-theme]` blocks;
- preserves consumer-local non-semantic variables such as `--gdg-*` as fallback
  surface state;
- prints transformed CSS by default, so a consumer can review the dry run before
  applying it with `--write`;
- prints a stable JSON dry-run report with `--json`, including whether the file
  would change and how many imports/declarations the codemod touched.

Dry run:

```bash
node codemods/ds-token-adoption.mjs --input vault-seed/.site/styles/marimo-vault.css --json
```

`package-workspace-adoption` covers generated or external consumer manifests:

- optionally sets the package `name` when a generated distribution needs a
  concrete package identity;
- rewrites only explicitly mapped `workspace:` dependency ranges, leaving other
  workspace references untouched;
- parses and emits `package.json` as structured JSON instead of doing string
  replacement;
- prints a stable JSON dry-run report with `--json`, including package-name and
  workspace-range counts.

Dry run:

```bash
node codemods/package-workspace-adoption.mjs --input vault-seed/package.template.json --external @aretw0/dgk-astro-plugins=latest --json
```

`node-test-to-vitest` covers opt-in ESM JavaScript/MJS test runner migrations:

- rewrites `node:test` imports to Vitest imports, mapping simple
  `before`/`after` calls to `beforeAll`/`afterAll` and `mock.*` namespace uses
  to `vi.*`;
- rewrites common `node:assert` / `node:assert/strict` calls (`equal`, `notEqual`,
  `deepEqual`, `ok`, `match`, `doesNotMatch`, `throws`, `rejects`,
  `doesNotReject`, `fail`) to `expect`;
- preserves assertion messages as Vitest expect messages for mapped assertions,
  including multiline `assert.match(...)` calls;
- preserves `assert.throws(fn, predicateFn)` semantics through an explicit
  `try/catch` predicate check instead of passing the predicate to `toThrow`;
- calls inline function suppliers before mapping `assert.doesNotReject(...)` to
  `.resolves`, so Vitest receives the Promise instead of the function object;
- leaves unsupported `assert.*` calls in place, keeps the assert import, and
  reports them in the JSON dry-run output for manual review;
- reports CommonJS `require("node:test")` / `require("node:assert")` files as
  unsupported instead of silently rewriting them into invalid ESM-in-CJS;
- does not add Vitest config, package dependencies, or CI wiring.

Dry run:

```bash
node codemods/node-test-to-vitest.mjs --input path/to/test.mjs --json
```

## Manual-Reviewed Line

`npm-scope-doc-sweep` stays `manual-reviewed` unless it becomes a recurring
transform with fixtures. It must use a reviewed replace list, not a blind owner
handle rewrite, because docs can mention accounts, migration history, examples,
and publish targets with different meanings.

## Promotion Beyond Local Scripts

There are now two ready local codemods. That is enough evidence to consider a
packaged runtime or shared surface, but not enough reason by itself. Promote
beyond local scripts only when a concrete consumer needs discovery, reuse, or
composition that cannot be handled by the checked-in dry-run commands.

## Non-Goals

- No hosted registry without a concrete consumer or distribution reason.
- No new package while local scripts plus registry metadata are sufficient.
- No MCP surface in this slice.
- No broad rewrite without fixtures, dry-run output, verification, and rollback
  notes.
- No codemods for ADR decisions or speculative research.
