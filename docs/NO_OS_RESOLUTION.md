# No resolver defaults to the OS

## The rule

A function that resolves "where does this node's state live" must take that
base **explicitly** — as a required argument, or by reading a declared source
(an env var, an injected config object). It must never *silently* fall back to
wherever the OS says the current process happens to be standing:

```ts
// The footgun — forgetting the argument does not raise an error.
function resolveTlsDir(root: string = process.cwd()): string { ... }
function scopedAssetsDir(options: { userHome?: string } = {}) {
  return options.userHome ?? homedir();
}
```

`process.cwd()` is almost always right while developing inside the repo and
almost always wrong the moment the process is invoked from anywhere else — a
cron job, a daemon, a different working directory, another checkout. The
failure is invisible exactly where it is tested and visible only where it
costs something.

**Two live instances**, both found by running rather than reading
(2026-08-05/07):

- `refarm connection status --json` listed the operator's VPN connection from
  `~/github/refarm` and returned **nothing** from `~/git/rcdc5` or `/tmp`. His
  own connection, invisible from inside his own workspace.
- The sandbox's plugin install wrote the working tree's `agent.wasm` into the
  operator's **real** `~/.refarm/assets/` (confirmed on disk, mtime
  2026-08-07 07:56), because `packages/storage-fs/src/scope.ts:60-63` does
  `options.userHome ?? homedir()` and never consults the declared home. This
  exact site is one of the 119 the ratchet below finds today.

## The two allowlisted modules — a WHITELIST

Exactly two modules are permitted to ask the OS where it is standing:

```
apps/refarm/src/utils/refarm-home.ts
packages/config/src/index.js
```

These are the **center**: 31 files import `refarm-home.ts` and 22 use
`declaredBase`/`sovereignDir` from `packages/config/src/index.js`. Every other
module is expected to go through one of these two, not to ask the OS on its
own.

This is a whitelist, not a blacklist of "known offenders," on purpose: a
blacklist only ever grows by someone remembering to add a new bad site to it.
A whitelist is complete by construction — a **third** module that starts
resolving the OS home is flagged automatically, the first time the ratchet
runs against it, with no one having to notice and add it anywhere.

The match is against a file's **full relative path from the repo root**,
never a basename — `packages/other/src/refarm-home.ts` (same filename,
different package) is **not** allowlisted, and the ratchet's own test pins
that distinction directly.

## Why `= process.env` is correct, and excluded by construction

```ts
function detectPackageManager({ cwd = process.cwd(), env = process.env } = {}) { ... }
```

`env = process.env` is a parameter default too — but reading the *declaration*
of the environment is exactly the right behaviour: a resolver that takes
`env = process.env` and later reads `env.REFARM_HOME` from it is doing what
this rule asks for, not violating it. The scanner never even looks for the
text `process.env` — the two resolver calls it searches for are
`process.cwd()` and every spelling of `homedir()` it can verify (see below).
`= process.env` is excluded **by construction**, not by a second check that
could drift out of sync: there is nothing in the pattern list for it to
accidentally match. There are roughly 92 such sites in this repo today, and
none of them are a target for this plan.

## The ratchet

`scripts/no-os-resolution.mjs` exports `scanForOsResolution(files)` — a PURE
function: it takes `{ path, content }` records and returns the offending
sites, never touching the filesystem itself. `collectScanFiles` is the thin
impure edge that walks `apps/*/src` and `packages/*/src` on a real checkout
and hands the pure function real file contents. `scripts/no-os-resolution.test.mjs`
composes the two (`computeBaseline`) and asserts the count. Run it directly to
see the CLI report without opening a test runner:

```bash
node scripts/no-os-resolution.mjs
# no-os-resolution: 119 offending site(s) across 918 scanned file(s) (default=61, fallback=58)
#   ceiling: 119
#   delta:   0
```

Two shapes are matched:

- **`default`** — a bare `=` (never `==`, `!=`, `<=`, `>=`, or `=>`)
  immediately followed by a resolver call. This covers a true function
  parameter default (`function f(root = process.cwd())`), a destructuring
  parameter default (`{ home = homedir() } = {}` — the real shape at
  `packages/farm-client/src/auth.mjs`), **and** a plain, unconditional
  variable assignment (`const x = process.cwd();`). The last of those is not
  "forgettable" the way a parameter default is, but it is still an unguarded
  direct read outside the two allowlisted modules, and it is exactly the
  shape the ratchet's own Step 5 proof (below) adds to confirm the guard
  fires — see `task-1-report.md` for the full reasoning and the measured
  effect of scoping this more narrowly.
- **`fallback`** — `?? <resolverCall>`, anywhere it appears. Unambiguous:
  `??` is always a fallback expression.

A resolver call only counts once its identity is verified against the file's
**own** `"node:os"` import — `homedir()` can be imported and called three
different ways, and the scanner handles each explicitly rather than trusting
bare text:

| Import shape | Example | Handling |
| --- | --- | --- |
| Default/namespace import | `import os from "node:os"` | `os.homedir()` is trusted — matched as a member call on that binding's local name. |
| Destructured, unaliased | `import { homedir } from "node:os"` | a bare `homedir()` call is trusted **only in this file**, because the import was found. |
| Destructured, aliased | `import { homedir as getHome } from "node:os"` | a bare `getHome()` call is trusted, under its **local** name — the scan follows the alias, not the literal word `homedir`. |

A bare `homedir()` call in a file with **no** `"node:os"` import at all is
never flagged — it might be an unrelated local function, and the scanner
would rather undercount than manufacture a false positive that erodes trust
in the whole mechanism.

**Comments and strings never count.** `maskComments` and
`maskStringsAndTemplates` blank out every `//` line comment, `/* */` block
comment, and single/double/backtick string (template literals included,
wholesale — see the doc comment on `maskStringsAndTemplates` for the one
documented gap this creates) before any resolver pattern is matched, so a
commented-out example or a string that happens to mention `process.cwd()`
can never inflate the count. Import-binding discovery runs on a
comments-masked-but-strings-intact pass specifically because the import
specifier `"node:os"` is itself a string literal that has to stay readable.

## Running a burn-down slice

1. Run `node scripts/no-os-resolution.mjs` (or read `sites` from
   `computeBaseline()` directly) to see every current offender, file and
   line.
2. Pick a coherent slice — one command family, not a scattering (see
   `docs/superpowers/plans/2026-08-07-no-resolver-defaults-to-the-os.md`,
   Task 2).
3. For each site in the slice, **audit before changing**: did the caller want
   the node's declared base, or the operator's current directory? Some
   commands (`release`, `cert`, `scan`) legitimately operate where the
   operator is standing — those get an **explicit** resolver call, never
   removed, just no longer a silent default.
4. Lower `BASELINE_MAX_OFFENDING_SITES` in `scripts/no-os-resolution.mjs` by
   exactly the number of sites the slice removed. State the before/after in
   the commit message. **Never raise it** to make a slice pass — a raised
   ceiling defeats the entire mechanism; the fix belongs in the code, not the
   guard.
5. Run `node --test scripts/no-os-resolution.test.mjs` and confirm the
   printed count matches the new ceiling exactly (delta `0`).

## Known limitations

The scanner is a text scanner over masked source, not a full parser — this
keeps it fast, dependency-free, and legible, at the cost of a few documented
gaps:

- **`||`-based fallbacks are not matched** — only `??`. Real, live examples
  exist today (`packages/health/src/auditors/*.js`, e.g.
  `context.rootDir || process.cwd()`), and are not part of this ratchet's
  count. A future slice could extend the pattern set to cover them
  explicitly; doing so silently here would have moved the baseline without
  anyone deciding to.
- **A resolver call reached only through a template literal's `${...}`
  interpolation is invisible** — template literals are masked wholesale, per
  the brief this file was built from ("an occurrence inside a string literal
  or template literal must NOT count"). No such shape exists in this repo
  today (verified 2026-08-07); a real tokenizer would recurse into `${...}`
  and this one does not.
- **A parenthesized assignment expression** (e.g. `while ((x = process.cwd()))`)
  could in principle be misclassified as a parameter default by the
  `default` shape's forward/backward delimiter check — no live example
  exists in this repo, but it is a theoretical false-positive class worth
  knowing about before trusting the scanner blindly on unfamiliar code.
- **Scope is `apps/*/src` and `packages/*/src` only** — `examples/*`,
  `validations/*`, and `templates/*` are out of scope, matching the plan this
  ratchet was built from, not an oversight.

## Wired into CI

`pnpm run no-os-resolution:test` runs `node --test scripts/no-os-resolution.test.mjs`.
It is a step in the `checkers` job of `.github/workflows/test.yml` — the home
for deterministic, UNGATED repo-invariant checks that run on **every**
push/PR regardless of which files changed, specifically so a `--no-verify`
push or a fresh clone cannot bypass it. See `task-1-report.md` for why this
placement was chosen over the alternatives that exist in this repo today.
