# An operator channel that can only ask has no way to say why

Date: 2026-08-03
Status: DESIGNED — approved by the maintainer before code.
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
	/** State a fact. Returns nothing, awaits nothing, throws nothing. */
	say(notice: string | OperatorNoticeInput): void;
}
```

**`say` is synchronous and total.** An announcement that could fail or block would be worse than the
silence it replaces — a broken remote transport must never be the reason a wizard stops working.
This is the same reasoning `currentPromptPublisher` already applies at line 247: a broken
notification arrangement must not prevent a question being asked.

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

## D7 — Five implementations, one invariant

| Channel | `say()` does |
|---|---|
| `createTerminalOperatorChannel` | writes to stdout — exactly what `console.log` does today |
| `createAutoOperatorChannel` | writes to stdout; a wizard in CI does not go mute |
| `createScriptedOperatorChannel` | **records into a list** the test can assert on |
| `createRemoteOperatorChannel` | `hub.announce()` |
| `createPeeredOperatorChannel` | both, in the order they were said |

**The invariant: with no publisher declared, `say()` is indistinguishable from today's
`console.log`.** This is the property `createStdioOperatorChannel` already protects for `ask` (line
288-298): silence is closed, and a process that declares nothing behaves exactly as it did.

The scripted channel recording rather than printing is what makes the regression test possible — the
assertion becomes "the preflight reached the channel", which is the thing that was false, rather than
"something was printed", which was always true.

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

## Cost

One method on an interface with five implementations, one hub verb plus a bounded ring, one field on
an existing wire envelope, and one call-site change in `delivery-add.ts` that deletes a silence.
Roughly a day.

The alternative measured in D2 — making `stream:v1` the operator log — requires a per-operator
`stream_ref`, abandoning `is_final`, lifting the resume cursor out of Rust into the TS contract, and
replacing `followStream`, **and still keeps the prompt hub**, because a question needs an answer
back. That is several slices, and it would be spent before a single notice exists to carry.
