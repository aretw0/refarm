# The node has to speak too, and its half is where the surfaces the operator carries actually read

Date: 2026-08-03
Status: DESIGNED — awaiting the maintainer's approval before code.
Protected surface: `packages/tractor/**` (CLAUDE.md §8, DEC-019). Direction authorised by the
maintainer on 2026-08-03; the serialised handoff is recorded in `.project/handoff.json`.
Companion to: [`2026-08-03-announcement-contract-design.md`](./2026-08-03-announcement-contract-design.md) (D1–D9).
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes

## What forced this

Executing the TypeScript half found the boundary by breaking on it. Adding three required members to
`PendingPromptHub` failed `type-check` at `apps/refarm/src/commands/pending-prompt-sidecar.ts:300`,
whose hub wrapper had to grow them — and reading why that wrapper exists showed what the first spec
had assumed wrongly.

**`GET /prompts` is served by Rust.** `packages/tractor/src/sidecar/pending_prompt.rs:624`,
`get_prompts`, returning `{ wire, pollIntervalMs, prompts }`. The TypeScript `handlePendingPromptHttp`
is a framework-free reference implementation used in tests; it is not the endpoint a device calls.

The real path is: the CLI publishes → `pending-prompt-sidecar.ts` `hold()` POSTs to the node → the
node holds the question → attending devices poll the **node's** `GET /prompts`.

So the first spec's D6, which put notices in the TypeScript envelope, reaches nobody's phone. After
all eight of its tasks:

| Surface | Path | Framing arrives? |
|---|---|---|
| Terminal | TS terminal channel | yes |
| Telegram / delivery | TS hub → `attachDeliveryToHub`, in-process | yes |
| PWA `/attend` | Rust `get_prompts` | **no** |
| Termux `farm-attend` | Rust `get_prompts` | **no** |

Two of the three surfaces the maintainer named are on the far side of that line.

## N1 — Notices cross by their own route, because transport is not delivery

The tempting move is a `notices` field on `PublishPromptRequest`: no new route, and it inherits the
auth posture `auth::ROUTE_PROMPTS` already declares. It is rejected, and the reason is worth stating
because the two rules look identical today.

**D9 ("framing rides the question") is a DELIVERY rule.** It exists so a three-line preflight is not
three Telegram messages. It governs what an *adapter sends*.

**The CLI→node hop is TRANSPORT.** It exists so the node's ring knows what was said, for surfaces
that *pull*.

Riding the publish makes transport inherit a delivery rule. The two coincide only while the sole
producer is a wizard that always asks next — and the tell is a sentence from the first draft of this
design, filed there as an accepted consequence: *"a notice with no question after it never leaves the
CLI."* That is not a consequence. That is the expedient's limitation leaking into the contract.

The node has more to say than wizard framing, and none of it asks anything:

- **"the VPN is up"** — `packages/delivery-contract-v1/src/index.ts:148-152` already documents
  exactly this (`needsDecision: false`, "a pure notice"), and has never had a producer.
- an automation's result — see N6, which corrects a claim made earlier in this work.
- progress of a declared operation.

If the canonical road is "a field on a question", each of those needs a road of its own — which is
precisely the fragmentation D2 of the companion spec already documented across `stream:v1`,
`connection_frames.rs` and `login-flow`. This would be the fourth.

So: **`POST /notices`**, its own route.

**Auth is not a new decision.** Publishing is the ASKER's side, exactly like `POST /prompts`, which
`sidecar/mod.rs:1742` records as *not* reachable by a `prompt:answer` scoped credential — that
credential belongs to whoever *answers* (the browser). `POST /notices` takes the same posture:
device credentials only, no scope declared in `auth::route_requirement`. `GET /prompts` continues to
carry them outward under the scope it already declares.

## N2 — The node stamps its own ordinal

The CLI sends `{ asker, message, kind }`. The node assigns `ordinal` and `at`, exactly as it already
assigns a prompt's `id` on publish.

This is not a detail. The node's ring is read by attending devices, and several CLI processes may
announce into one node. A CLI-assigned ordinal would collide across processes and mean nothing to a
poller; the node's own sequence is the one a device can dedupe against, which is what D3 said the
ordinal was for.

Consequence, accepted: a notice's ordinal on the node differs from its ordinal in the CLI that said
it. They are cursors into two different logs, and neither side needs the other's.

## N3 — Ring on the node, and no watermark there

`HubInner` (`pending_prompt.rs:355`) gains what mirrors the TypeScript hub:

```rust
struct HubInner {
    entries: HashMap<String, HubEntry>,
    recent: Vec<PendingPromptSettlement>,
    notices: Vec<OperatorNotice>,
    notice_seq: u64,
    seq: u64,
    max_pending: usize,
    recent_capacity: usize,
    notice_capacity: usize,
}
```

with `DEFAULT_RECENT_NOTICES: usize = 32`, beside `DEFAULT_RECENT_SETTLEMENTS`, for the same reason
D5 gives: a device that opens `/attend` after the question was asked still reads the framing that
explains it.

**No watermark on the node.** A watermark belongs to a consumer that batches, and the node's readers
do not batch — they poll and dedupe on `ordinal` client-side. The node offers `announce` and
`notices()`, and nothing that mutates on read.

## N4 — The sidecar posts on say, and MUST serialise

`pending-prompt-sidecar.ts`'s `announce` stops delegating only locally and also POSTs to the node.

**Order is load-bearing and is not free here.** `say()` is synchronous and total (D1), so it cannot
await. Three notices said in a row would produce three concurrent POSTs, and the node stamps
`ordinal` on arrival — so the operator's phone could show the preflight shuffled. Framing out of
order is worse than framing absent: it reads as incoherence rather than as omission.

So the sidecar holds a **serialised queue**: each POST awaits the previous one, the queue is internal,
and `say()` still returns immediately. A failed POST is swallowed and the next one still goes — a
broken notification arrangement must not be why a wizard stops working, which is the judgement
`currentPromptPublisher` already makes.

## N5 — A correction to the companion spec's D9 rationale

The companion spec justifies the pure `noticesFor(command, since)` by saying two consumers — delivery
and the node hop — would starve each other on a shared watermark. **With N1 and N4, the node hop
never calls `noticesFor`**: it posts at the moment of saying. Only delivery batches, so only delivery
holds a cursor.

The correction stands on a simpler footing, and the code comment in
`packages/prompt-contract-v1/src/index.ts` must be amended to say it rather than keep a rationale that
is now false: **the hub must not hold state belonging to whoever reads it**, and a pure query is what
makes the ordinal an actual cursor instead of a number with hidden bookkeeping behind it.

## N6 — A claim made earlier in this work, corrected

While arguing N1 this design cited "the automation result — the `daily-handoff` cron already running"
as evidence of future non-wizard notice producers. **That cron does not run.** `.project/automations.json`
declares it (`status: "active"`, trigger `cron @daily`) and there is no executor: `systemctl --user
list-timers` reports zero timers and there is no crontab.

`refarm resume --json` nonetheless reports it as `"status": "scheduled"` with a computed `fireKey` and
`"resume": { "visible": true }`. That output describes what was DECLARED, and reads as what EXECUTES.

The argument in N1 survives without it — `delivery-contract-v1:148-152` already names a producerless
notice genre in the codebase itself. The correction is recorded because `refarm resume` is the command
CLAUDE.md §4 tells every agent to run first, so an agent that trusts it will plan against an executor
that does not exist. **Distinguishing `declared` from `scheduled` is its own slice**, not folded in
here, and it is cheap.

## What this is not

- **Not persistence.** The node's notice ring dies with the node, exactly as its prompts do (P1).
- **Not a second vocabulary.** `OperatorNotice` in Rust mirrors `operator-notice.v1` field for field;
  the discriminator does not fork.
- **Not the standalone status notice.** "The VPN is up" becomes possible once this road exists, but
  its producer is not in this slice.

## Verification the change must carry

1. **Round trip** — a notice POSTed by the CLI appears in the node's `GET /prompts` `notices` array,
   parsing cleanly through the TypeScript `parseOperatorNotice`.
2. **Ordinal is the node's, monotonic across askers**, and survives its asker's prompt settling.
3. **Ring bounded** at `DEFAULT_RECENT_NOTICES`.
4. **Order preserved under three rapid `say()` calls** — the assertion N4 exists for. It must fail if
   the sidecar's queue is removed.
5. **Auth** — `POST /notices` is refused for a `prompt:answer` scoped credential and accepted for a
   device credential, mirroring `POST /prompts`.
6. **Unknown kind degrades to `context`** on the node's deserialise, never dropping the message.
7. **The wire does not bump** — a frozen kit parses `prompts` from the node's envelope unchanged.

## Cost

One struct, four fields on `HubInner`, two methods on `PromptHub`, one route, one handler, one field
on `get_prompts` — and on the TypeScript side a serialised POST queue in the sidecar plus the comment
correction from N5. Comparable to the TS half, with the Rust test suite (`cargo test --lib`, the
cheapest signal per CLAUDE.md §7) carrying items 1-4 and 6.
