# Declaring is authoring — a wizard to the same file

Date: 2026-07-31
Status: First slice implemented — `refarm delivery add` (+ `refarm delivery test`)
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes
Pairs with: [`2026-07-31-declared-delivery-design.md`](2026-07-31-declared-delivery-design.md),
[`2026-07-30-operation-consent-and-record-design.md`](2026-07-30-operation-consent-and-record-design.md)

## What forced this

Enabling Telegram delivery was handed to the operator as a list of manual steps: talk to BotFather,
save a token to a file, hand-edit `.refarm/config.json`. Their answer:

> *"não deixando eu preso a ter que fazer as coisas na unha … quero que até superfícies novas tenham
> uma boa experiência em serem intencionadas … no mesmo nível de qualidade que queremos facilitar a
> construção bem arquitetada e soberana."*

They are right, and the gap is structural rather than a missing convenience. The declared-catalog
doctrine — `connections`, `surfaces`, `workspaces`, `delivery` — bought sovereignty by making
everything an explicit declaration the operator owns. What it left behind was **authoring**: to use
any of it you must edit JSON by hand, knowing the vocabulary by heart. Sovereignty over a thing you
cannot comfortably write is sovereignty on paper.

## A1 — Declaring is authoring, and authoring deserves a wizard

A declaration is a piece of writing. The repo has spent five designs making sure the *content* is
the operator's; it has said nothing about the *act* of writing it. This document says: the act gets
the same care as the content, and a guided path is the normal way to produce a declaration — not a
concession for beginners.

The measure is the operator's own: *"no mesmo nível de qualidade que queremos facilitar a construção
bem arquitetada e soberana."* The wizard is held to the standard of the architecture it writes for.

## A2 — One source of truth: the wizard writes the same `.refarm/config.json`

This is the rule that keeps A1 from becoming a mess, and it is not negotiable.

- The wizard's output is **the same file, in the same vocabulary, read by the same parser**. There
  is no sidecar state, no "wizard-managed" section, no generated file that must be kept in sync.
- **Hand-editing keeps working**, permanently. It is the path that must never break, because it is
  the path that works when the wizard does not exist yet, when the adapter is new, when there is no
  terminal, and when the operator simply prefers it.
- **The wizard understands what was hand-written.** It reads the existing declaration, shows it, and
  (with consent) replaces it. A hand-written block is not "unmanaged"; it is the input.

A second source of truth would undo the whole catalog doctrine: the config would stop being the
answer to "what is declared here", and the operator would have to know which of two places won.

## A3 — The line: a wizard ASKS; it does not SYNTHESISE

Earlier the same day, a launch script that **generated** the operator's declaration with `jq` was
removed from this repo, and they were right to refuse it. That refusal is not in tension with this
document — it is what defines its boundary.

| synthesising | authoring |
| :-- | :-- |
| infers what the operator "must have meant" | asks, in words they can answer |
| writes, then tells | shows the exact change, then waits |
| the declaration is the tool's | the declaration is the operator's; only the keyboard is borrowed |

Operationally: **every value in the written entry came from an answer or an explicit flag.** Nothing
is detected, defaulted-from-the-environment, or filled in on the operator's behalf. Where a value
genuinely cannot be guessed — `capability`, `unattended` — the parser already refuses to guess, and
the wizard respects that refusal rather than routing around it.

The consent journey is what makes the difference executable rather than a promise: the change is
rendered in full and applied only after an authorisation, through
`@refarm.dev/operation-consent-v1`.

## A4 — Consume the blocks that already exist

Nothing about this slice is new machinery. It is three existing blocks pointed at authoring:

- **`@refarm.dev/prompt-contract-v1`** — surface-neutral prompts, including the secret prompt that
  never echoes and cancellation that settles rather than hangs. Because the wizard asks through
  `OperatorChannel`, it inherits declared delivery for free (D5): the questions can reach the
  operator's phone without the wizard containing one line about delivery.
- **`@refarm.dev/operation-consent-v1`** — R2 (the request IS the diff: this file, this line, and
  what the file looks like right now) and R3 (the record carries an undo that executes). The trail
  is the same `<root>/.refarm/operations.json` that `refarm config history` already reads, so
  `refarm config history undo <id> --local` reverses a wizard's write with no new command.
- **`refarm delivery route --json`** — validates the wiring *without sending*, which is what lets
  the wizard end by **verifying instead of claiming**.

## A5 — The secret is not part of the change set

The token is prompted without echo and written to `<sovereign>/delivery/<name>.token` at mode
`0600`; the declaration references it by `tokenFile`.

The non-obvious half: the token file is **deliberately outside the consent operation's change set**.
An `OperationFileChange` carries full before/after snapshots into a durable trail — so anything
placed in the change set is anything written into `operations.json`. A durable trail is exactly
where a secret must not be. The config file is the change set; the token write happens after the
authorisation, is named in the request's notes, and if it fails the declaration is rolled back
through the trail's own undo, so a config pointing at a token that was never written cannot exist.

The cost, stated because the operator should know it: **the undo restores the config and leaves the
token file.** That is said in the undo summary. Removing a secret on an undo would be the more
surprising behaviour.

## A6 — Ask about a capability by its consequence, not by its name

`capability` and `unattended` are the two fields the delivery parser refuses to guess. A wizard that
asked "declare a capability" would only relocate the vocabulary problem into a prompt.

So they are asked as what they mean, each option stating what follows from it:

- *"«telegram» consegue trazer uma **decisão** de volta pra mim?"* — yes means refarm may ask a
  question here and wait for the choice; no means refarm will never send a decision this way, and
  the notification only says something is waiting.
- *"«telegram» te alcança quando você **não está atendendo** — celular no bolso, terminal fechado?"*
  — yes means a question at 3am reaches you; no means that without an armed attention window
  (`refarm intention arm`) refarm skips the channel and the question waits.

And S3 is applied to the *offer*, not only to the validation: an option the chosen adapter cannot
enforce is never presented. The operator cannot over-claim by accident, so
`refuseOverclaimedDeclaration` becomes the backstop it was designed to be rather than the first
thing they meet.

## A7 — End by verifying; offer the real send separately

The wizard finishes by re-reading the declaration **from disk** and running the real router against
a hypothetical decision. That proves the bytes it wrote parse, resolve and route — a claim it could
not make from the values still in memory.

A **real** test send is `refarm delivery test <name>`: a separate command, with its own confirmation,
every time. Bundling it into the wizard is how a small yes ("declare this channel") becomes a large
one ("and talk to a third party on my behalf") — the operator would have authorised the second
without ever being asked it.

## A8 — Re-running: never duplicate, never clobber, never re-ask by accident

A catalog is keyed, so a duplicate is impossible by construction. What *is* possible is a silent
overwrite, and a wizard that re-asks a question the operator already answered. Both are gated:

- **Already declared** → the wizard says so and asks whether to replace. Declining is a *successful*
  outcome (`unchanged`), not a failure: `ok` means "the command did its job", and its job was to ask.
- **Already decided** (an authorisation or a refusal in the trail, even if the entry was later
  hand-removed) → R4 applies: it is not re-asked by accident. The operator is told what they decided
  and when, and asked whether to reconsider.
- Either gate can be skipped with `--replace`, which means "I know, ask me anyway".
- A replacement passes `revisit: true`, so the trail shows a **chain** — the new record links to the
  one it supersedes — rather than two unrelated answers.

## A9 — No TTY means refuse, not hang and not assume

Flags exist for scripted use (`--adapter`, `--capability`, `--unattended`, `--token-env`,
`--option key=value`), and they replace the **questions**. They do not replace the **authorisation**.

With no terminal there is nobody to authorise, so the command refuses — immediately, with the repo's
envelope, and naming the two paths that do work: run it at a terminal, or write the block by hand.
There is deliberately no `--yes`: a flag that suppresses the one question worth asking would turn
this back into the synthesising script A3 refuses.

## How these are held

Beyond the ordinary tests, two rules are **mutation-verified** — the rule was broken in the source
and the suite was confirmed to go red before the break was reverted:

- *the token never reaches the config, the trail, or any printed line* — adding the token value to
  the entry turns two tests red;
- *a cancelled or declined run leaves nothing half-written* — moving the token write to before the
  authorisation turns four tests red.

The consent journey's record is not merely inspected: the undo is **applied inside the test**, and
the config file is asserted byte-identical to what it was before.

## What comes next, and what does not

The seam is `apps/refarm/src/commands/catalog-authoring.ts`: plan the exact before/after for one
entry in one catalog block, build the operation request, render the whole diff, run the consent
journey, record it beside the config. It knows nothing about delivery. A second consumer writes its
question set and nothing else.

Candidates, all of which require hand-editing today:

| catalog | what a wizard would have to ask | why it is not this slice |
| :-- | :-- | :-- |
| `connections` | which host, which transport, guardrails | the richest vocabulary; worth doing second, once the seam has survived one real consumer |
| `surfaces` | which surface, which port, open-by-declaration | needs the surface registry to expose what each surface requires, the way adapters do here |
| `workspaces` | mounts, sources, the declared-command allowlist | the allowlist is a security surface; its wizard needs its own thinking about what "showing the change" means for a command list |

What is explicitly **not** next: a configuration language, a schema DSL, or a generic form generator
driven by JSON Schema. The systemd/s6 lesson recorded in the connections design applies unchanged —
converge the vocabulary, do not build a language. Three hand-written question sets are cheaper to
read, and cheaper to be right about, than one engine that generates all of them.
