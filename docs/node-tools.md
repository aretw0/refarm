# Declared node tools

A node runs on tools it did not build: `gh`, `rsync`, `cargo`, a VPN client.
They live outside every artifact this repository produces, they drift on their
own schedule, and until 2026-08-18 nothing here noticed when they did.

The failure is specific and was measured on the operator's own node:

```
$ gh --version
gh version 2.4.0+dfsg1 (2022-03-23 Ubuntu 2.4.0+dfsg1-2)
```

Present. Exits 0. Every check that asks *"is it installed?"* says yes — right up
to the first `gh` subcommand that version does not have, failing in the middle of
unrelated work. **Presence was never the question.**

## The declaration

`nodeTools` in the **node**-tier config (`<declaredBase()>/.refarm/config.json`,
normally `~/.refarm/config.json`):

```json
{
  "nodeTools": {
    "gh": { "minVersion": "2.40.0", "why": "CI handoffs and run watching" },
    "rsync": { "why": "node backup and restore" }
  }
}
```

A **catalog block keyed by command**, the same shape `delivery`, `connections`,
`surfaces` and `workspaces` use. Not cosmetic: `planCatalogDeclaration` refuses a
block that is not a record, so an array would be a declaration no guided command
could ever write — and the key being the command settles what two entries naming
one binary mean. They cannot exist.

| Field | Required | Meaning |
| --- | --- | --- |
| *(the key)* | yes | the binary to run |
| `minVersion` | no | the declared floor. Omit it and presence *is* the whole question |
| `why` | no | what breaks without it — carried into the reported finding |
| `args` | no | defaults to `["--version"]` |

**You do not write this by hand** — see *Declaring one, guided* below.

**Declared, never inferred.** Reading the requirement off whatever happens to be
installed turns today's accident into tomorrow's contract. A node that declares
nothing measures nothing, so adopting this changes no existing node's report.

## What does NOT belong here

Some floors are already declared, and enforced, somewhere else:

| Fact | Already declared in | Enforced by |
| --- | --- | --- |
| Node's version | `package.json` → `engines.node` | the package manager, at install |
| pnpm's version | `package.json` → `packageManager` | corepack |
| the Rust channel | `rust-toolchain.toml` | rustup, per invocation |

Repeating them in `nodeTools` creates a second source of truth for one fact, and
the two drift on the day one of them is bumped. Declare here what **nothing else
declares**: `gh`, `rsync`, `docker`, `gpg`, a VPN client — the tools a node reaches
for that no manifest in the tree has an opinion about.

## Four states, because four repairs

`packages/health/src/tool-requirements.js` — pure, and the single place this
decision is made.

| State | What it means | What the operator does |
| --- | --- | --- |
| `ok` | present, at or above the floor | nothing |
| `absent` | the command did not run | install it, or drop the entry |
| `outdated` | present, below the floor | update it, or lower the floor |
| `cannot-say` | present, floor declared, version unreadable | read the banner by hand |

`cannot-say` is the load-bearing one. Collapsing it into `ok` reports success on
a claim nothing verified — the same failure the node inventory already carries a
warning about, where a backup guided by documentation saves the wrong base and
reports success. Collapsing it into `outdated` accuses a tool that may be
perfectly current.

A malformed entry is **reported, never dropped**. An entry the operator believes
is guarding a tool, which silently guards nothing, is the worst of the five
outcomes: it looks like coverage.

## Why the node tier, and only the node tier

Auditing a declared tool **runs it**. Whoever may write this key chooses which
binaries the machine executes, and cloning a repository whose
`.refarm/config.json` declared `nodeTools` would be enough.

`docs/CONFIG_TIERS.md` registers `nodeTools` as node-owned and
workspace-**requestable**: a repository may legitimately say *"I need `gh` >=
2.40.0"*, it may not hold the declaration. Because `auditConfigTier` is
reporting-only today, `readNodeToolDeclaration` enforces this at the reader
itself — the code that creates the risk is the code that closes it. A workspace
config declaring `nodeTools` is not honoured, and says so:

```
<repo>/.refarm/config.json declares nodeTools, which only the node tier may
hold — auditing a tool runs it, so a repository declaring this would choose
which binaries this machine executes. Move it to the node config to honour it.
```

## Not cached, deliberately

`refarm health` caches its audit behind a fingerprint over the **repository**. A
node tool lives outside that tree entirely — which is the whole reason this
surface exists — so no hash of the repository can notice `gh` being upgraded.
Tool checks are re-measured on every run, including cache hits. An operator who
updates a tool and re-runs `health` must not be handed back the stale answer they
just repaired.

## Declaring one, guided

```bash
refarm tools add gh          # measures it, proposes the floor it just read, asks why
refarm tools list            # every declared tool AND the ones that are fine
```

`tools add` composes three blocks this repository already had, and re-implements
none of them:

| Block | What it contributes |
| --- | --- |
| `@refarm.dev/prompt-contract-v1` | asks over a channel that is not assumed to be a terminal — the same wizard reaches an attended surface |
| `@refarm.dev/operation-consent-v1` | shows the whole diff, records the decision, keeps an undo |
| `catalog-authoring.ts` | writes one keyed entry, preserving fields it does not own |

The only part `tools.ts` owns is the part that is genuinely about tools:
**measuring the binary before asking**, so the floor the operator authorises is a
number they were shown rather than one they had to remember. That is the line
between a draft the operator accepts and an inference nobody decided — and it is
why this cannot be a plain `config set`.

Two things it refuses to do quietly:

- A tool that is **not installed** is refused, not declared. Wanting to declare
  one you are about to install is reasonable; doing it by accident starts the
  node reporting a finding nobody chose. `--even-if-absent` says it out loud.
- The consent notes say that authorising this **also authorises an execution** —
  `health` will run the binary on every audit from now on. Burying that in this
  document and not in the prompt would be consent to the wrong thing.

With nobody to ask, nothing is written and the result is `deferred`. A
consent-gated write with no operator is not a silent write.

### It is not a terminal command

`--attended-elsewhere` routes the whole journey through the node's pending-prompt
hub instead of stdio. **Measured live 2026-08-18** against the node at
`127.0.0.1:42001`:

```bash
refarm tools add gh --min 2.40.0 --why "…" --attended-elsewhere --json &

curl -s http://127.0.0.1:42001/prompts        # the consent select, all three options
curl -s -X POST .../prompts/$ID/answer \
     -d '{"value":"authorize","device":"…"}'  # answered from outside
```

The command woke, returned `status: "authorized"`, and wrote the declaration.
The terminal was never used for the decision. That is the same
`pending-prompt.v1` wire an attending PWA or a phone reads — `curl` stands in for
the device, not for the protocol.

The measurement travels with the question: a device is asked to authorise a floor
it was **shown**, because authorising a number you were never told is trusting the
asker rather than deciding.

With `--attended-elsewhere` and no publisher installed, the outcome is the same
`deferred` as a headless terminal. Attending elsewhere is a route, not a promise.

## Where it surfaces


```bash
refarm health --json    # results.nodeTools.{checks,malformed}
```

Unsatisfied tools become recommendations with **no `command`**: this node has no
verb that installs software, and a dead entry in `nextCommands` is followed by
every agent loop in this repository. The action is prose, and the repair is the
operator's.

Findings count toward `issueCount`, so `ok` cannot report all-clear while
recommending a repair. Only a node that declared tools can reach this.

## What this is a step toward

Describing the node and rebuilding it, rather than copying it. `nodeTools` is the
first declaration of a dependency that lives *outside* the repository — the same
shape `modelAuthorization` uses for accounts, applied to the substrate the node
stands on. See `refarm context --inventory` for the live side of the same
question.
