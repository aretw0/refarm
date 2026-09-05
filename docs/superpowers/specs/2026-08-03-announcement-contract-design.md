# An operator channel that can only ask has no way to say why

Date: 2026-08-03
Status: DESIGNED — awaiting the maintainer's approval of this revision, before code.
Revised 2026-08-03 after an adversarial review of the first draft, which found six defects: the
peered channel had nowhere to put the verb (D7), the contract exists in two copies rather than one
(Cost), a required method would break `prompt:v1` implementors (D1), the scripted channel could not
be asserted on and conformance would print (D8), and — the substantive one, from the maintainer's
own constraint about being reached on two surfaces — announcements did not reach the PUSH surfaces
at all, and the naive repair would have multiplied the noise there (D9).
Lane: [`docs/CONVERGENCE-LANE.md`](../../CONVERGENCE-LANE.md) — interfaces, devices and nodes
Phase: 13, opening slice.

## What forced this

The operator ran `refarm delivery add` from Termux and came away believing it was a Telegram
feature. It is not — it is a wizard over an adapter registry that happens to have one adapter
registered today. Two independent silences produced that reading, and neither is a wording problem.

**The framing never left the node.** `delivery-add.ts:599-600` says the adapter summary and its
preflight — including "refarm não cria bot nem fala com o BotFather por você. O bot é seu; eu só
guardo a referência." — through `say()`, which at line 490 defaults to `console.log`. The
QUESTIONS, meanwhile, go through `operator.ask()`, which since the peered-channel work also
publishes to attending devices. So on the phone the operator received the questions with the
explanation stripped off.

**The registry never announced itself.** `delivery-add.ts:571-573`:

```ts
adapterId = available.length === 1 ? available[0]! : await operator.ask({ … });
```

With one adapter registered the select is skipped entirely. The operator is never shown the word
"registry", never sees a choice, and correctly infers there wasn't one.

## The finding that decides the shape

**`OperatorChannel` has exactly one method.** `prompt-contract-v1/src/index.ts:55-61` declares
`ask()` in four overloads and nothing else. `OperatorPrompt` is
`ConfirmPrompt | SelectPrompt | TextPrompt | SecretPrompt` — four ways to pose a question, zero ways
to state a fact.

So the muteness is not `delivery add`'s. Every wizard that needs to explain itself has the same two
choices: `console.log` (stays on the node) or bend a question into carrying the explanation. Every
future surface — Telegram-as-operation-surface, the PWA — inherits it. That is why this precedes
them rather than following them.

## D1 — The channel gains a verb, not the prompt union a member

The tempting cheap move is a fifth member of `OperatorPrompt` (`{ type: "notice" }`), because every
transport then carries it for free. It is rejected: `ask()` returns an answer and a notice has none.
It would occupy the hub's pending map, need settling, and need a special case in
`promptAnswerTravels`, in `checkPendingPromptAnswer`, and in conformance. An hour today, paid for in
every surface afterwards.

`OperatorChannel` gains `say()` beside `ask()`. The four `ask` overloads are untouched.

```ts
export interface OperatorChannel {
	ask(prompt: ConfirmPrompt): Promise<boolean>;
	ask(prompt: SelectPrompt): Promise<string>;
	ask(prompt: TextPrompt): Promise<string>;
	ask(prompt: SecretPrompt): Promise<string>;
	ask(prompt: OperatorPrompt): Promise<boolean | string>;
	/** State a fact. Returns nothing, awaits nothing, throws nothing.
	 *  OPTIONAL — see below. */
	say?(notice: string | OperatorNoticeInput): void;
}
```

**`say` is synchronous and total.** An announcement that could fail or block would be worse than the
silence it replaces — a broken remote transport must never be the reason a wizard stops working.
This is the same reasoning `currentPromptPublisher` already applies at line 247: a broken
notification arrangement must not prevent a question being asked.

**`say` is OPTIONAL, and that is a versioning decision, not a convenience.** `prompt:v1` is a
versioned capability contract. A new REQUIRED method on `OperatorChannel` is breaking for anyone
implementing it — and the point of publishing a contract is that we cannot enumerate its
implementors. In-repo the cost is visible and small (three object literals in `auth.test.ts` at
lines 1366, 2135 and 2157 implement `ask` alone); out of repo it is unknowable.

So: `say?`, every call site goes through `channel.say?.(…)`, and a channel that does not implement it
degrades to exactly today's behaviour. `PROMPT_CAPABILITY` stays `prompt:v1`, and the frozen kit on
the phone stays valid.

The cost is real and accepted: the type no longer forces a NEW channel author to consider the verb.
`runOperatorChannelConformance` compensates — it reports whether a channel announces, so "this
channel is mute" becomes an observed fact rather than a silent one.

## D2 — `stream:v1` is not the substrate, and the survey that said it was conflated two things

The 2026-07-28 note recorded in the handoff proposed projecting `stream:v1`'s existing `notice`
frames rather than growing a second vocabulary. Measured, that premise does not hold:

- **`stream:v1` has no `notice`.** `stream-contract-v1/src/types.ts:8` declares
  `payload_kind?: "text_delta" | "final_text" | "final_tool_call" | "final_empty" | "error"`. The
  `notice` in this codebase is in two other places: `connection_frames.rs:76` writes it as a
  free-form chunk kind for connection establishment, and `login-flow/src/index.ts:38` has its own
  event union. Three vocabularies, none of them `stream:v1`'s.
- **The resume cursor is not in the contract either.** It exists in `connection_frames.rs` — the
  Rust connection subsystem storing `last_sequence`/`chunk_count` in a CRDT node. Real, but not
  something `stream-contract-v1` exposes.
- **The semantics are of another thing.** `followStream` follows *until `is_final`*, defaults to a
  45s timeout, and returns `content` concatenated into one string
  (`stream-follower/src/types.ts:38-45`). It is a stream **per unit of work**. An operator log never
  ends, has no `is_final`, and does not concatenate.

What is true of `stream:v1`: three transports (ws/sse/file) plus the follower client half, and a
conformance suite covering replay-on-late-subscribe and sequence ordering. Good, and not applicable
here.

**And the path would be wrong regardless.** `stream:v1` travels the CRDT with a `stream_ref`;
prompts travel `OperatorChannel` → `PromptPublisher.remote()` → `PendingPromptHub` → `GET /prompts`.
Routing announcements through the first would deliver framing to a different place than the
questions it frames, with no ordering relation between them — the defect this exists to fix, rebuilt
with more steps. `StreamTransportAdapter` is also `write`/`subscribe` only: a question needs an
answer coming back, so the prompt path survives either way.

**The axis the survey missed.** `say()` is about the VERB (can the channel state a fact?);
a durable log is about the SUBSTRATE (is there an ordered, resumable record?). They do not compete.
The substrate is worth having — it is what the PWA needs for history and offline — and `say()` is
what would produce the entries it carries. So the decision is to build the verb now with a shape
that a durable transport can carry later without a contract change (D3).

## D3 — The ordinal is what makes the later substrate a transport swap

```ts
export const OPERATOR_NOTICE_WIRE = "operator-notice.v1" as const;

export type OperatorNoticeKind = "context" | "decision" | "caution";

/** What a caller passes. The hub stamps the rest. */
export interface OperatorNoticeInput {
	message: string;
	/** Defaults to "context". */
	kind?: OperatorNoticeKind;
}

export interface OperatorNotice {
	wire: typeof OPERATOR_NOTICE_WIRE;
	/** Monotonic across the hub. A durable transport resumes from it; a poller
	 *  dedupes on it. */
	ordinal: number;
	message: string;
	kind: OperatorNoticeKind;
	asker: PendingPromptAsker;
	/** Epoch ms. */
	at: number;
}
```

The caller supplies the message and, when it matters, the kind. The hub stamps `ordinal`, `asker`
and `at` — the same division `toPendingPrompt` already makes, where the caller gives an
`OperatorPrompt` and the shape stamps id/asker/askedAt.

**The ordinal is hub-global, not per-asker.** A resume cursor wants to be a number, not a map.
Global-monotonic is what `stream:v1`'s `sequence` is, which is precisely what makes a later durable
transport a transport change rather than a redesign.

## D4 — The kinds are derived from what the wizards already say

The maintainer's instruction was not to wait for a second consumer, so the vocabulary ships now. It
is derived from the eight existing `say()` call sites rather than invented. The test applied: **does
this distinction change what the operator should do?** By that test the framing lines collapse into
one kind and two others earn their place.

| Existing line | Kind |
|---|---|
| "Telegram — o bot fala com você no app que já está no seu bolso." | `context` |
| "Você precisa de um bot SEU e do token dele (@BotFather…)" | `context` |
| "E do chatId: a conversa em que o bot fala com você…" | `context` |
| "refarm não cria bot nem fala com o BotFather por você." | `context` |
| "O token vai para `…`, com permissão 0600." | `context` |
| "Ele NUNCA entra no config.json e nunca aparece em log." | `context` |
| `renderCatalogProposal(request)` lines | `context` |
| "`telegram` só sabe avisar — este canal fica como `announce`." | `decision` |
| "`telegram` só te alcança enquanto você está atendendo." | `decision` |
| "Isto envia uma mensagem REAL agora — sai desta máquina." | `caution` |

- **`context`** — framing, prerequisites, what will be written. Missing it costs understanding.
  The default, so `say("…")` stays cheap at the call site.
- **`decision`** — refarm chose or narrowed something on the operator's behalf. Missing it means
  **believing you chose**. This is the named form of the second silence in "What forced this": the
  wizard taking the single adapter without a word IS an unannounced decision.
- **`caution`** — the next answer causes an outward or irreversible effect. Sibling of
  `answerTravels` (line 981), which already marks "answering this puts the value on the wire".

## D5 — Retention is the `recentSettlements` precedent, not the P1 lifetime rule

P1 says a pending prompt is never persisted and dies with its asker, because once the asker is gone
nobody is waiting for the answer. **That reasoning does not transfer.** A notice has nobody waiting
by definition; its value is precisely that it can be read afterwards. Copying P1 here would kill the
thing for the wrong reason.

The hub already has the right precedent: `recentSettlements` (line 1249), a fixed-size ring of
settled prompts kept so a peer that lost the race is told what happened instead of getting a bare
404. Notices take the same mechanism and the same default:

- bounded ring, hub-global, default 32, never persisted, never grown;
- an attending device that opens `/attend` after the wizard has already asked still reads the
  preflight that frames the question on its screen.

## D6 — Additive on the wire, so a frozen kit degrades to today

`GET /prompts` gains a sibling to `prompts`:

```ts
{ wire: "pending-prompt.v1", pollIntervalMs, prompts: [...], notices: [...] }
```

`PENDING_PROMPT_WIRE` does **not** bump. The doc above the constant says it moves only for a
breaking change, and `parsePendingPromptList` (line 1144) reads `body.prompts` and ignores unknown
fields — so this is exactly the additive growth the existing parser already tolerates by design.

A kit frozen at whatever `farm-update` last fetched shows no notices and otherwise behaves byte for
byte as today. That is the correct degradation, and the same judgement `checkPendingPromptWire`
makes when it admits `unknown` rather than locking the operator out of a device that works.

**No `?since=`.** `PendingPromptHttpRequest` declares "Path only — no query string" (line 1606), and
the ring is 32 entries. A device filters on `ordinal` client-side for free. `?since=` becomes natural
when a durable transport arrives — which is what the ordinal exists for.

## D7 — Announcement has no lifecycle, so the publisher must not demand one

`PeeredOperatorChannelOptions.remote(signal)` is a FACTORY CALLED PER ASK (line 1498, used at 1535):
each question gets its own `RemoteOperatorChannel` and its own `AbortSignal`, because a question has
a lifetime — it can be withdrawn, expire, or lose a race.

`say()` happens outside any ask. Routing it through that factory would mean constructing a whole
remote channel, with a signal that never fires, to state one sentence — bending a per-question
lifecycle around something that has none.

So `PromptPublisher` gains a sibling to `remote`:

```ts
export interface PromptPublisher {
	/** Build the elsewhere-side channel for ONE ask, interruptible by `signal`. */
	remote(signal: AbortSignal): RemoteOperatorChannel;
	/** Publish a statement. No lifecycle, so no signal. Optional: a publisher that
	 *  cannot announce simply does not, and the terminal still says it. */
	announce?(notice: OperatorNoticeInput): void;
}
```

`createStdioOperatorChannel`'s peered path then calls `publisher.announce?.()` for `say` and
`publisher.remote(signal)` for `ask`, and the two verbs stop sharing machinery neither needed.

## D8 — Five channels (ten implementations — see Cost), one invariant

| Channel | `say()` does |
|---|---|
| `createTerminalOperatorChannel` | writes to stdout — exactly what `console.log` does today |
| `createAutoOperatorChannel` | writes to stdout; a wizard in CI does not go mute |
| `createScriptedOperatorChannel` | **records into a list** the test can assert on |
| `createRemoteOperatorChannel` | `hub.announce()` |
| `createPeeredOperatorChannel` | terminal + `publisher.announce?.()` (D7), in the order said |

Two consequences of that table that are easy to get wrong:

**`createScriptedOperatorChannel` needs a wider return type.** It records notices, but
`OperatorChannel` exposes no way to read them, so a test could not assert what was recorded. It
returns `ScriptedOperatorChannel extends OperatorChannel` with a `notices(): readonly
OperatorNoticeInput[]` accessor. Without this, verification 3 below cannot be written — which is the
whole point of the scripted channel recording rather than printing.

**Conformance must not print.** `runOperatorChannelConformance` runs against the auto and scripted
channels, and the auto channel writes to stdout — so a naive `say("_conformance_")` check would spit
text into every suite that runs conformance. The check passes a sink (`output`) it can read instead,
the way the existing checks pass canned answers rather than touching a real terminal.

**The invariant: with no publisher declared, `say()` is indistinguishable from today's
`console.log`.** This is the property `createStdioOperatorChannel` already protects for `ask` (line
288-298): silence is closed, and a process that declares nothing behaves exactly as it did.

The scripted channel recording rather than printing is what makes the regression test possible — the
assertion becomes "the preflight reached the channel", which is the thing that was false, rather than
"something was printed", which was always true.

## D9 — A notice never pushes on its own; it travels attached to the next question

The maintainer's constraint, and the finding it forced: **Telegram and the PWA reach the operator by
opposite mechanisms.** The PWA and `farm-attend` PULL — they poll `GET /prompts`. Telegram PUSHES —
it is a delivery adapter, driven at `delivery.ts:334` by `hub.subscribe((pending) => …)`, which
builds a message with `deliveryRequestFromPendingPrompt(pending)` and sends it.

D6 alone therefore fixes the bug only on the pull surfaces. On Telegram — the surface the operator
actually carries — questions would keep arriving stripped of their framing, which is the original
defect, unfixed, on the channel that matters most.

And the naive repair is worse. If `announce()` notified the prompt subscribers the way `publish()`
does, `delivery add`'s preflight would become **three Telegram messages before the question**. With
both Telegram and the PWA declared — which is the maintainer's own test configuration — that is
noise on two channels at once, for one wizard.

**The rule:** `hub.announce()` does NOT notify the prompt subscribers. Notices accumulate in the
ring (D5). When a prompt IS published, the delivery request carries the notices from the SAME asker
since that asker's previous prompt, so framing and question arrive as ONE message per channel.

Consequences, all of them intended:

- **One message per channel, never N+1.** Declaring two surfaces costs two messages, not two times
  the number of framing lines.
- **A notice with no question after it never pushes.** Correct: nothing is blocked, so nobody needs
  waking. It stays visible on the pull surfaces, which is where a reader who came looking will see it.
- **`caution` lands with the confirm it precedes** — "Isto envia uma mensagem REAL agora" arrives in
  the same message as "Envio a mensagem de teste?", which is the only arrangement in which the
  warning can do its job.

The hub tracks a per-asker watermark (the ordinal of the last notice already attached) so a notice is
never sent twice and never skipped. That watermark is also what a durable transport (D3) would resume
from, which is a second reason the ordinal is hub-global.

## What this is not

- **Not a logging framework.** A notice is addressed to the operator attending an operation, not to
  an operator reading logs later. There is no level, no logger name, no formatting.
- **Not a replacement for the prompt path.** Questions still need answers coming back; `say()` is
  one-way.
- **Not the durable operator log.** That is a later slice, and D3 is what keeps it from becoming a
  redesign.
- **Not a change to any existing wizard's behaviour at a terminal.** D7's invariant is load-bearing.

## Verification the change must carry

1. **Conformance gains a sixth check** — every `OperatorChannel` accepts `say()` and does not throw,
   including with an unreachable publisher.
2. **Hub** — ordinal strictly monotonic across askers; ring bounded at capacity; notices survive
   their asker's settlement.
3. **The regression that would have caught this** — `delivery add` driven by a scripted channel
   asserts the adapter summary and all three preflight lines arrived **on the channel**, and that
   the single-adapter path emits a `decision` notice naming the registry.
4. **Wire compatibility** — an envelope carrying `notices` still parses to identical `prompts`
   through the unchanged `parsePendingPromptList`.
5. **The invariant** — a terminal channel with no publisher declared produces byte-identical stdout
   to `console.log` for the same lines.
6. **A notice never pushes alone (D9)** — announcing without a following prompt drives the delivery
   subscriber at `delivery.ts:334` **zero** times; announcing three lines and then asking drives it
   **once**, with all three carried in that one request. This is the assertion that keeps the
   two-channel test configuration from becoming two-channel noise.
7. **Both copies agree** — the vendored `farm-client` copy is byte-identical to the source after the
   change, asserted rather than assumed (see the loose end under Cost).

## Cost

**The contract exists in two copies, and both must move.**
`packages/farm-client/vendor/prompt-contract-v1/src/index.ts` is byte-identical to the source
(verified with `diff`). That duplication is deliberate and load-bearing — it is what lets a phone
parse the wire from a bare `git pull`, with nothing installed. So it is not five implementations of
`say`, it is **ten**: five in the package, five in the vendored copy.

> **CORRECTED 2026-08-03 — this paragraph was wrong, and the correction is the useful part.**
>
> It read: `packages/farm-client/README.md:19` names a guard, `scripts/ci/test-farm-client-decoupled.mjs`,
> that does not exist — therefore nothing keeps the vendored copy honest. The first half is true;
> **the conclusion is false.** Both invariants are guarded, from inside the kit's own suite:
> `packages/farm-client/test/decoupled.test.mjs` refuses any import outside Node builtins and
> `./lib` siblings, and `packages/farm-client/test/vendor.test.mjs` checks every vendored copy
> byte-for-byte against its BUILT source — building the block when its gitignored `dist` is absent,
> because "a check that quietly passes when it cannot look is not a check".
>
> Only the README's pointer was stale. It now names the real files.
>
> The error was expensive enough to record: acting on it, this slice `cp`-ed `src/index.ts` into the
> vendor tree and turned the kit red. `scripts/vendor.mjs` carries THREE assets per block
> (`dist/index.js`, its `.map`, and `src/index.ts`), so a partial `cp` leaves the kit consistent on
> the surface and drifted underneath — which is precisely the failure the real guard exists to catch,
> and it caught it. **The fix for drift is `node scripts/vendor.mjs`, never a hand copy.**

So: one optional method across ten implementations, one hub verb plus a bounded ring and a per-asker
watermark, one field on an existing wire envelope, one sibling on `PromptPublisher`, the delivery
attachment rule at `delivery.ts:334`, and one call-site change in `delivery-add.ts` that deletes a
silence. Roughly a day and a half, most of it in the two copies staying honest.

The alternative measured in D2 — making `stream:v1` the operator log — requires a per-operator
`stream_ref`, abandoning `is_final`, lifting the resume cursor out of Rust into the TS contract, and
replacing `followStream`, **and still keeps the prompt hub**, because a question needs an answer
back. That is several slices, and it would be spent before a single notice exists to carry.
