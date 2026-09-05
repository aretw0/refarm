# Configuration is an operation: asked for, authorised, and remembered

Date: 2026-07-30
Status: Designed, not implemented
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — substrate / DX

## What forced this

The cold-bootstrap installer finished on the operator's phone and told them:

```
atalhos em /data/data/com.termux/files/home/.local/bin — que NÃO está no seu PATH.
Acrescente esta linha ao seu perfil … e reabra o shell:
    export PATH="$HOME/.local/bin:$PATH"
(não mexo no seu perfil sozinho)
```

Refusing to edit their profile unasked is right. Leaving them to do it by hand is not what they want:

> *"Quero soberania total, sem precisar fazer nada na unha, facilitar ao máximo a intenção
> necessária acontecer com autorização da operação como boa prática … devemos ter soberania sobre as
> configurações que fazemos como quem quer trabalhar com sustentabilidade, não configura nada e
> esquece, lembra até pra poder entender se foi bem feito."*

Two requirements, and the second is the one that is usually skipped: **do it for me, with my
authorisation** and **remember what was done, so I can later judge whether it was done well**.

## What already exists (measured, 2026-07-30)

- **`packages/wallet/src/consent.ts` already implements this journey**, for a different domain: a
  service *submits* a request, the citizen *sees* the pending item and *decides* — authorise (→ a
  signed receipt) or decline — **before anything is disclosed**. A pending request is a durable
  record, so it survives, lists, and can be declined later.
- **`@refarm.dev/authorization-contract-v1`** ships the render and the receipt journey.
- **`history-contract-v1`** appends full snapshots on every change, with the diff a pure function
  computed on demand.
- **`refarm config set` / `unset` record nothing at all.** Grep finds no config-change log anywhere
  in the repo, and `refarm config` has no `history`.

So the journey is built and proven. It has simply never been pointed at configuration.

## R1 — The journey generalises; the receipt does not

`AuthorizationReceipt` carries `holder`, `requester`, `purpose`, `scope[]`, `expiresAt`, `proof` —
the vocabulary of **attribute disclosure**. It records *what was revealed*.

A configuration operation needs to record *what was changed* and *how to undo it*. Those are
different facts, and `scope: string[]` cannot hold them. Reusing the receipt because it is available
would be picking the contract at hand over the contract that fits — the mistake this repo made three
times today in the other direction, writing an implementation where it meant a concept.

So: **the journey is the reusable thing** — submit → see → decide → receipt → durable trail. An
operation gets a sibling record with its own fields, sharing the queue, the decision step and the
history mechanism.

## R2 — A request states the change exactly, before it is made

The pending item is not "may I configure your shell?". It is the diff: **this file, this line, at
this position, and here is what the file looks like now.** The operator authorises a specific
change, not a category of permission.

This is [D13](2026-07-28-declared-connections-shared-sessions-design.md) again — an attempt that
needs a human must first acquire the human — with the addition that the human must be shown enough
to decide rather than merely asked to consent.

## R3 — The record must answer "was this well done?", which means it must carry the undo

The operator's word is *sustentabilidade*: configuration you can revisit, not configuration you
forget. That sets the bar for the record. It must carry, at minimum:

- **what changed** — file, before, after; a full snapshot, following `history-contract-v1`'s reasoning
  that snapshots are the only honest reconstruction without a structural delta engine;
- **why** — the purpose stated in the request the operator authorised;
- **who asked and who authorised**, and when;
- **how to undo it** — enough to reverse the change, or an explicit statement that it is
  irreversible, which is itself information the operator deserves *before* deciding.

A record without the undo is a log. A log tells you something happened; it does not give you
sovereignty over it.

## R4 — Declining is a first-class outcome, and it is remembered too

A declined request must be recorded, not silently dropped. Otherwise the same wizard asks again next
run and the operator has no way to see that they already said no — the exact behaviour that trains
people to click through prompts. `consent.ts` already treats decline as a real decision distinct from
a granted receipt; keep that.

## R5 — It works on the phone, because the prompt block is already there

`vendor/prompt-contract-v1.mjs` shipped to the device in today's kit — verified in the manifest and
in the operator's install output. So the ask can happen on the device, through the same
surface-neutral block the node uses, with cancellation already handled.

The record is a different question: a device that has no farm credential yet cannot write to the
node. First slice keeps the record local to whichever machine performed the operation, and
converging device records into the node is a later slice, gated on nothing but wanting it.

## First slice

The PATH line the installer currently refuses to write. It is small, real, blocked the operator
today, and exercises every part: a request stating the exact line and file, a decision, an applied
change, a record carrying the undo, and a declined path that is remembered.

`refarm config set`/`unset` become the second consumer — they mutate persisted configuration today
and record nothing, which is the same gap one layer in.

## Built (2026-07-30) — the second consumer, and what it taught

The two parts above turn out to be **separable**, and separating them is the whole design decision
for this consumer. The consent PROMPT is for something proposing a change *on the operator's
behalf*. `refarm config set runtime.autostart always` is not that: the operator typed it. Asking
them to confirm what they just typed carries no information and costs exactly what R4 protects — a
prompt nobody learns from is a prompt people learn to click through, and the next one, the real one,
gets waved past too. So `config set`/`unset` get the RECORD and no confirmation, and consequently no
`--yes` flag: there is nothing to suppress.

`recordOperation` is that half of the block — apply, append, and roll the files back if the trail
cannot be written. It takes no channel parameter at all, so a consumer cannot accidentally acquire
a confirmation step. It also does not consult the standing decision: a declined PATH line must not
be re-asked, but a config value set twice is two changes, and the second is not a question anyone
declined.

R3 is unchanged and fully paid. The change carries full before/after snapshots of the config file
(read as BYTES, so the undo restores what was on disk rather than a re-serialisation of what
parsed), the purpose, who asked and who authorised, when, and an executable undo. `--why` is
optional and carried verbatim; absent, the purpose states WHAT was asked for rather than inventing
a motive.

**Where the record lives: beside the configuration it describes**, `<scope>/.refarm/operations.json`.
For the default home scope that IS `~/.refarm/operations.json` — the same file the kit writes its
PATH decision into, so one command answers "what has been configured on this machine" whichever
tool did it. The kit put it outside the kit dir so a decision survives `farm-update`; a home-scoped
config change has the same lifetime. For `--local` it is `<repo>/.refarm/operations.json` instead,
because a record whose file path points inside a checkout must not outlive the checkout, and
because `config history --local` in one repo must not show another repo's changes. Node-scoped
(replicated) stays out of this slice for R5's reason.

**`refarm config history`** closes R3's other half: a record nobody can read is a log. It lists what
changed, when, who, why, and the exact command that reverses it; `refarm config history undo <id>`
executes that reversal and appends it as its own record, so the trail stays append-only and reads as
what happened rather than as a claim that it did not. An unset that removed nothing changes nothing
and records nothing — a trail of undos that restore a file to itself is noise dressed as memory.
