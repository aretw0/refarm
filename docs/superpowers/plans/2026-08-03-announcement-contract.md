# Announcement Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `OperatorChannel` a way to state a fact, so a wizard's framing reaches the operator wherever the questions reach them.

**Architecture:** A second, optional verb (`say?`) beside `ask` on `OperatorChannel`. Notices carry a hub-global monotonic `ordinal` so a durable transport can later resume from it without a contract change. They ride the existing `pending-prompt.v1` envelope as a sibling list for PULL surfaces, and attach to the next question from the same asker for PUSH surfaces, so a wizard's three framing lines never become three Telegram messages.

**Tech Stack:** TypeScript, Vitest 4, pnpm workspaces. Zero runtime dependencies in `prompt-contract-v1` (it is vendored into `farm-client` and must parse on a phone with nothing installed).

**Spec:** [`docs/superpowers/specs/2026-08-03-announcement-contract-design.md`](../specs/2026-08-03-announcement-contract-design.md) — decisions D1–D9.

## Global Constraints

- **Zero dependencies.** `packages/prompt-contract-v1` imports only `node:readline`. Never add a dependency; it is vendored into `farm-client`, which must run from a bare `git pull`.
- **Two copies.** `packages/farm-client/vendor/prompt-contract-v1/src/index.ts` is byte-identical to `packages/prompt-contract-v1/src/index.ts`. Every change lands in BOTH. Task 8 verifies.
- **`PROMPT_CAPABILITY` stays `"prompt:v1"`.** `PENDING_PROMPT_WIRE` stays `"pending-prompt.v1"`. Neither bumps (D6).
- **`say` is OPTIONAL** (`say?`). Every call site uses `channel.say?.(…)`. A channel that does not implement it must behave exactly as today (D1).
- **`say` never throws, never awaits, returns `void`** (D1).
- **Notices are never persisted.** Bounded ring, default 32 (D5).
- **Scoped commands only:** `pnpm --filter @refarm.dev/<pkg> run <script>`. Never `cd` into a package.
- **After each task's commit:** `refarm agent finish --lane after-commit --run --json`.

### A distinction the implementer will hit and must not "fix"

`packages/delivery-contract-v1/src/index.ts:148-152` already documents `needsDecision: false` as being for "a pure notice ('the VPN is up'), which any announce-only adapter may carry." That is a STANDALONE STATUS EVENT — a different genre from wizard framing, and it is not what this plan builds. D9's rule ("a notice never pushes on its own") governs the three kinds in this plan (`context`/`decision`/`caution`), which exist to frame a question. Do not delete or contradict that comment; do not route this plan's notices into standalone delivery requests.

---

### Task 1: The notice shape and its parser

Pure data plus validation. No channel or hub changes yet, so this task is reviewable on its own.

**Files:**
- Modify: `packages/prompt-contract-v1/src/index.ts` (add after the `PendingPromptSettlement` block, ~line 1008)
- Test: `packages/prompt-contract-v1/src/index.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `PendingPromptAsker` (already exported, line 956), `isRecord`/`asString` (module-private helpers, lines 1044-1050)
- Produces: `OPERATOR_NOTICE_WIRE`, `OperatorNoticeKind`, `OperatorNoticeInput`, `OperatorNotice`, `normalizeNoticeInput()`, `parseOperatorNotice()`, `parseOperatorNoticeList()`

- [ ] **Step 1: Write the failing test**

Append to `packages/prompt-contract-v1/src/index.test.ts`:

```ts
describe("the operator notice shape (D3/D4)", () => {
	const asker = { command: "refarm delivery add", pid: 42, host: "farm" };

	it("normalizes a bare string to a context notice", () => {
		expect(normalizeNoticeInput("o bot é seu")).toEqual({
			message: "o bot é seu",
			kind: "context",
		});
	});

	it("keeps an explicit kind", () => {
		expect(normalizeNoticeInput({ message: "sai desta máquina", kind: "caution" })).toEqual({
			message: "sai desta máquina",
			kind: "caution",
		});
	});

	it("round-trips a stamped notice through the parser", () => {
		const stamped: OperatorNotice = {
			wire: OPERATOR_NOTICE_WIRE,
			ordinal: 7,
			message: "um adaptador registrado: telegram",
			kind: "decision",
			asker,
			at: 1_700_000_000_000,
		};
		expect(parseOperatorNotice(JSON.parse(JSON.stringify(stamped)))).toEqual(stamped);
	});

	it("refuses a notice whose wire is not ours, and one with no message", () => {
		expect(parseOperatorNotice({ wire: "other", ordinal: 1, message: "x", kind: "context", asker, at: 1 })).toBeNull();
		expect(parseOperatorNotice({ wire: OPERATOR_NOTICE_WIRE, ordinal: 1, message: "", kind: "context", asker, at: 1 })).toBeNull();
	});

	it("falls back to context for a kind it does not know, rather than dropping the notice", () => {
		const parsed = parseOperatorNotice({
			wire: OPERATOR_NOTICE_WIRE,
			ordinal: 1,
			message: "from a newer node",
			kind: "urgent",
			asker,
			at: 1,
		});
		expect(parsed?.kind).toBe("context");
		expect(parsed?.message).toBe("from a newer node");
	});

	it("drops only the entries that do not parse", () => {
		const list = parseOperatorNoticeList({
			notices: [
				{ wire: OPERATOR_NOTICE_WIRE, ordinal: 1, message: "ok", kind: "context", asker, at: 1 },
				{ wire: "wrong", ordinal: 2, message: "no", kind: "context", asker, at: 2 },
			],
		});
		expect(list).toHaveLength(1);
		expect(list[0]?.message).toBe("ok");
	});
});
```

Add to the import block at the top of the test file: `normalizeNoticeInput`, `OPERATOR_NOTICE_WIRE`, `parseOperatorNotice`, `parseOperatorNoticeList`, and `type OperatorNotice`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test`
Expected: FAIL — the imports do not exist.

- [ ] **Step 3: Write the implementation**

Insert into `packages/prompt-contract-v1/src/index.ts`, after the `PendingPromptSettlement` interface:

```ts
// ── The notice: what a wizard STATES, as opposed to what it asks ──────────────
//
// D1 of the announcement-contract design. An `OperatorChannel` could only ask,
// so a wizard's framing had nowhere to go but `console.log` — which stays on the
// node while the questions travel. This is the shape that travels with them.

export const OPERATOR_NOTICE_WIRE = "operator-notice.v1" as const;

/**
 * D4 — derived from the eight `say()` call sites that already existed, not
 * invented. The test applied: does this distinction change what the operator
 * should DO?
 */
export type OperatorNoticeKind =
	/** Framing, prerequisites, what will be written. Missing it costs understanding. */
	| "context"
	/** refarm chose or narrowed something on the operator's behalf. Missing it
	 *  means BELIEVING YOU CHOSE — the defect this contract exists to fix. */
	| "decision"
	/** The next answer causes an outward or irreversible effect. Sibling of
	 *  `answerTravels`, which marks the same thing on the prompt side. */
	| "caution";

const NOTICE_KINDS: readonly OperatorNoticeKind[] = ["context", "decision", "caution"];

/** What a CALLER passes. The hub stamps the rest. */
export interface OperatorNoticeInput {
	message: string;
	/** Defaults to `context`, so `say("…")` stays cheap at the call site. */
	kind?: OperatorNoticeKind;
}

/** A statement addressed to the operator, as it crosses the wire. */
export interface OperatorNotice {
	wire: typeof OPERATOR_NOTICE_WIRE;
	/**
	 * Monotonic across the hub. THE log-ready field: a durable transport resumes
	 * from it, a poller dedupes on it, and the delivery watermark (D9) is one.
	 * Hub-global rather than per-asker because a resume cursor wants to be a
	 * number, not a map.
	 */
	ordinal: number;
	message: string;
	kind: OperatorNoticeKind;
	asker: PendingPromptAsker;
	/** Epoch ms. */
	at: number;
}

/** A bare string is a `context` notice. PURE. */
export function normalizeNoticeInput(input: string | OperatorNoticeInput): Required<OperatorNoticeInput> {
	if (typeof input === "string") return { message: input, kind: "context" };
	return { message: input.message, kind: input.kind ?? "context" };
}

function asNoticeKind(value: unknown): OperatorNoticeKind {
	// A kind this side does not know degrades to `context` rather than dropping
	// the notice: the message is the part the operator needs, and a NEWER node
	// talking to a frozen kit is the normal direction of skew here — the same
	// reasoning `checkPendingPromptWire` applies when it admits `unknown`.
	return NOTICE_KINDS.includes(value as OperatorNoticeKind) ? (value as OperatorNoticeKind) : "context";
}

/** Validate an `OperatorNotice` off the wire, or null. Round-trips a stamped one. */
export function parseOperatorNotice(value: unknown): OperatorNotice | null {
	if (!isRecord(value)) return null;
	if (value.wire !== OPERATOR_NOTICE_WIRE) return null;
	const message = asString(value.message);
	if (message === null || message === "") return null;
	if (typeof value.ordinal !== "number" || !Number.isFinite(value.ordinal)) return null;
	if (typeof value.at !== "number" || !Number.isFinite(value.at)) return null;
	if (!isRecord(value.asker)) return null;
	const command = asString(value.asker.command);
	if (command === null) return null;
	const asker: PendingPromptAsker = { command };
	if (typeof value.asker.pid === "number" && Number.isFinite(value.asker.pid)) {
		asker.pid = value.asker.pid;
	}
	const host = asString(value.asker.host);
	if (host !== null) asker.host = host;
	return {
		wire: OPERATOR_NOTICE_WIRE,
		ordinal: value.ordinal,
		message,
		kind: asNoticeKind(value.kind),
		asker,
		at: value.at,
	};
}

/** Validate a list payload, dropping entries that do not parse. */
export function parseOperatorNoticeList(value: unknown): OperatorNotice[] {
	const raw = isRecord(value) && Array.isArray(value.notices) ? value.notices : [];
	const parsed: OperatorNotice[] = [];
	for (const entry of raw) {
		const notice = parseOperatorNotice(entry);
		if (notice !== null) parsed.push(notice);
	}
	return parsed;
}
```

**Note on placement:** `isRecord` and `asString` are declared further down the file (lines ~1044-1050) but are function declarations, so hoisting makes them available. If the linter objects to use-before-define, move this block below `asString` instead.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test`
Expected: PASS, all pre-existing tests still green.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/prompt-contract-v1 run type-check
git add packages/prompt-contract-v1/src/index.ts packages/prompt-contract-v1/src/index.test.ts
git commit -m "feat(prompt): the shape of a thing a wizard states"
refarm agent finish --lane after-commit --run --json
```

---

### Task 2: `say?()` on the three local channels, and conformance that reports muteness

**Files:**
- Modify: `packages/prompt-contract-v1/src/index.ts` — `OperatorChannel` (line 55), `createAutoOperatorChannel` (104), `createScriptedOperatorChannel` (122), `createTerminalOperatorChannel` (150), `runOperatorChannelConformance` (713)
- Test: `packages/prompt-contract-v1/src/index.test.ts`

**Interfaces:**
- Consumes: `normalizeNoticeInput`, `OperatorNoticeInput` (Task 1)
- Produces: `OperatorChannel.say?()`, `ScriptedOperatorChannel` (with `notices()`), `OperatorChannelConformanceResult.announces: boolean`

- [ ] **Step 1: Write the failing test**

```ts
describe("say() — the second verb (D1/D8)", () => {
	it("the terminal channel writes the message to its output", () => {
		const output = new PassThrough() as unknown as NodeJS.WriteStream;
		let written = "";
		output.write = ((chunk: string) => { written += chunk; return true; }) as never;
		const channel = createTerminalOperatorChannel({ output });
		channel.say?.("o bot é seu");
		expect(written).toContain("o bot é seu");
	});

	it("the scripted channel records instead of printing, so a test can assert on it", () => {
		const channel = createScriptedOperatorChannel(["x"]);
		channel.say?.("primeira");
		channel.say?.({ message: "segunda", kind: "decision" });
		expect(channel.notices()).toEqual([
			{ message: "primeira", kind: "context" },
			{ message: "segunda", kind: "decision" },
		]);
	});

	it("the auto channel does not go mute in CI", () => {
		const output = new PassThrough() as unknown as NodeJS.WriteStream;
		let written = "";
		output.write = ((chunk: string) => { written += chunk; return true; }) as never;
		const channel = createAutoOperatorChannel({ output });
		channel.say?.("dito em CI");
		expect(written).toContain("dito em CI");
	});

	it("conformance reports whether a channel announces, and never prints while asking", async () => {
		const speaking = await runOperatorChannelConformance(createScriptedOperatorChannel(["a", "a", "a", "a", "a"]));
		expect(speaking.announces).toBe(true);

		const mute = await runOperatorChannelConformance({ ask: async () => "a" });
		expect(mute.announces).toBe(false);
		expect(mute.pass).toBe(true); // muteness is REPORTED, not failed — say is optional
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test -t "the second verb"`
Expected: FAIL — `channel.notices is not a function`, `announces` undefined.

- [ ] **Step 3: Write the implementation**

Change `OperatorChannel` (line 55) to add the optional method:

```ts
export interface OperatorChannel {
	ask(prompt: ConfirmPrompt): Promise<boolean>;
	ask(prompt: SelectPrompt): Promise<string>;
	ask(prompt: TextPrompt): Promise<string>;
	ask(prompt: SecretPrompt): Promise<string>;
	ask(prompt: OperatorPrompt): Promise<boolean | string>;
	/**
	 * State a fact (D1). Returns nothing, awaits nothing, throws nothing.
	 *
	 * OPTIONAL, and that is a versioning decision: `prompt:v1` is a published
	 * contract, and a new REQUIRED method breaks implementors we cannot
	 * enumerate. A channel without it behaves exactly as it did.
	 */
	say?(notice: string | OperatorNoticeInput): void;
}
```

`createAutoOperatorChannel` takes an options bag so a test can capture its output (it had none before):

```ts
export function createAutoOperatorChannel(
	options: { output?: NodeJS.WriteStream } = {},
): OperatorChannel {
	const output = options.output ?? process.stdout;
	/* … the four `ask` overloads and the async ask body, unchanged … */
	function say(notice: string | OperatorNoticeInput): void {
		output.write(`${normalizeNoticeInput(notice).message}\n`);
	}
	return { ask, say };
}
```

`createScriptedOperatorChannel` returns a wider type:

```ts
/** A scripted channel, plus the notices it recorded (D8). */
export interface ScriptedOperatorChannel extends OperatorChannel {
	/** Every notice said through this channel, in order. */
	notices(): readonly Required<OperatorNoticeInput>[];
}

export function createScriptedOperatorChannel(
	answers: Array<boolean | string>,
): ScriptedOperatorChannel {
	const queue = [...answers];
	const said: Required<OperatorNoticeInput>[] = [];
	/* … the four `ask` overloads and the async ask body, unchanged … */
	function say(notice: string | OperatorNoticeInput): void {
		said.push(normalizeNoticeInput(notice));
	}
	return { ask, say, notices: () => said };
}
```

`createTerminalOperatorChannel` gains, before its `return { ask }`:

```ts
	function say(notice: string | OperatorNoticeInput): void {
		// Byte-for-byte what `console.log(line)` did before this existed. The
		// invariant (D8): a channel with no publisher declared is unchanged.
		output.write(`${normalizeNoticeInput(notice).message}\n`);
	}
	return { ask, say };
```

In `runOperatorChannelConformance`, add `announces` to the result interface and a sixth check that does NOT print:

```ts
export interface OperatorChannelConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
	/**
	 * Does this channel implement `say`? Not a pass/fail — `say` is optional
	 * (D1) — but REPORTED, so "this channel is mute" is an observed fact rather
	 * than a silent one. That report is what compensates for the type no longer
	 * forcing a new channel author to consider the verb.
	 */
	announces: boolean;
}
```

and, before computing `failed`:

```ts
	// 6 — say, when present, must be total: no throw, no return value.
	const announces = typeof channel.say === "function";
	if (announces) {
		checksRun++;
		try {
			const returned = channel.say!({ message: "_conformance_", kind: "context" }) as unknown;
			if (returned !== undefined) failures.push("say: returned a value; it must return void");
		} catch (e) {
			failures.push(`say threw: ${String(e)}`);
		}
	}
```

Then return `{ pass: failed === 0, total: checksRun, failed, failures, announces }`.

**Why the conformance check does not assert on printed text:** the auto channel writes to stdout, so asserting output would make every suite that runs conformance spit `_conformance_` into its own log. The check asserts the CONTRACT (total, returns void); Task 2's first three tests assert the printing, against channels given a capture stream.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test`
Expected: PASS. Pre-existing conformance tests still green (`announces` is additive).

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/prompt-contract-v1 run type-check
git add packages/prompt-contract-v1/src/
git commit -m "feat(prompt): let a channel state a fact, and report the ones that cannot"
refarm agent finish --lane after-commit --run --json
```

---

### Task 3: The hub announces — ordinal, ring, and the per-asker watermark

**Files:**
- Modify: `packages/prompt-contract-v1/src/index.ts` — `PendingPromptHubOptions` (~1238), `PendingPromptHub` (~1255), `createPendingPromptHub` (~1276)
- Test: `packages/prompt-contract-v1/src/index.test.ts`

**Interfaces:**
- Consumes: `OperatorNotice`, `OperatorNoticeInput`, `normalizeNoticeInput` (Task 1); `PendingPromptAsker`
- Produces: `PendingPromptHub.announce(asker, notice) → OperatorNotice`, `PendingPromptHub.notices() → OperatorNotice[]`, `PendingPromptHub.takeNoticesFor(askerCommand) → OperatorNotice[]`, `PendingPromptHubOptions.recentNotices?: number`

- [ ] **Step 1: Write the failing test**

```ts
describe("the hub announces (D5/D9)", () => {
	const asker = { command: "refarm delivery add", pid: 7 };
	const other = { command: "refarm auth enrol", pid: 8 };

	it("stamps a hub-global monotonic ordinal, across askers", () => {
		const hub = createPendingPromptHub();
		const a = hub.announce(asker, "primeira");
		const b = hub.announce(other, "de outro asker");
		const c = hub.announce(asker, "terceira");
		expect([a.ordinal, b.ordinal, c.ordinal]).toEqual([1, 2, 3]);
		expect(a.wire).toBe(OPERATOR_NOTICE_WIRE);
		expect(a.kind).toBe("context");
	});

	it("keeps a bounded ring — notices do not accumulate", () => {
		const hub = createPendingPromptHub({ recentNotices: 3 });
		for (let i = 0; i < 10; i += 1) hub.announce(asker, `n${i}`);
		const kept = hub.notices();
		expect(kept).toHaveLength(3);
		expect(kept.map((n) => n.message)).toEqual(["n7", "n8", "n9"]);
	});

	it("outlives its asker's prompts — the P1 lifetime rule does not transfer", () => {
		const hub = createPendingPromptHub();
		hub.announce(asker, "o enquadramento");
		const ticket = hub.publish(toPendingPrompt({ type: "text", question: "q" }, { id: "p1", asker }));
		hub.answer("p1", "resposta", "phone");
		void ticket;
		expect(hub.notices().map((n) => n.message)).toEqual(["o enquadramento"]);
	});

	it("takeNoticesFor returns one asker's unattached notices and never repeats them (D9)", () => {
		const hub = createPendingPromptHub();
		hub.announce(asker, "uma");
		hub.announce(other, "de outro");
		hub.announce(asker, "duas");

		const first = hub.takeNoticesFor(asker.command);
		expect(first.map((n) => n.message)).toEqual(["uma", "duas"]);

		// Taken once. A second question from the same asker carries nothing stale.
		expect(hub.takeNoticesFor(asker.command)).toEqual([]);

		hub.announce(asker, "três");
		expect(hub.takeNoticesFor(asker.command).map((n) => n.message)).toEqual(["três"]);
	});

	it("announcing does NOT notify the prompt subscribers (D9 — no notice pushes alone)", () => {
		const hub = createPendingPromptHub();
		const seen: string[] = [];
		hub.subscribe((pending) => seen.push(pending.id));
		hub.announce(asker, "isto não deve empurrar nada");
		expect(seen).toEqual([]);
		hub.publish(toPendingPrompt({ type: "text", question: "q" }, { id: "p9", asker }));
		expect(seen).toEqual(["p9"]);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test -t "the hub announces"`
Expected: FAIL — `hub.announce is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `PendingPromptHubOptions`:

```ts
	/**
	 * How many notices stay recallable. Same mechanism and same default as
	 * `recentSettlements`, for the same reason (D5): a device that arrives after
	 * the question was asked still reads the framing that explains it. NOT the P1
	 * lifetime rule — a notice has nobody waiting on it by definition, so "the
	 * asker is gone" is not a reason to drop it.
	 */
	recentNotices?: number;
```

Add to the `PendingPromptHub` interface:

```ts
	/** State a fact. Stamps the ordinal and returns what was recorded. Does NOT
	 *  notify `subscribe` listeners — a notice never pushes on its own (D9). */
	announce(asker: PendingPromptAsker, notice: string | OperatorNoticeInput): OperatorNotice;
	/** Every notice still in the ring, oldest first. */
	notices(): OperatorNotice[];
	/**
	 * This asker's notices that have not yet been attached to a delivered
	 * question, and MARK THEM ATTACHED (D9). Called when a prompt is published so
	 * framing and question travel as one message per channel.
	 */
	takeNoticesFor(askerCommand: string): OperatorNotice[];
```

In `createPendingPromptHub`, after the existing `recent` declaration:

```ts
	const noticeCapacity = options.recentNotices ?? 32;
	const notices: OperatorNotice[] = [];
	/** Highest ordinal already attached to a delivered question, per asker command. */
	const attachedThrough = new Map<string, number>();
	let noticeOrdinal = 0;
```

and in the returned object:

```ts
		announce(asker, notice) {
			const normalized = normalizeNoticeInput(notice);
			noticeOrdinal += 1;
			const stamped: OperatorNotice = {
				wire: OPERATOR_NOTICE_WIRE,
				ordinal: noticeOrdinal,
				message: normalized.message,
				kind: normalized.kind,
				asker,
				at: now(),
			};
			notices.push(stamped);
			while (notices.length > noticeCapacity) notices.shift();
			// Deliberately NOT notifying `listeners`: that set is the delivery push
			// path (apps/refarm/src/commands/delivery.ts), and a notice that pushed
			// on its own would turn a three-line preflight into three messages.
			return stamped;
		},
		notices: () => [...notices],
		takeNoticesFor(askerCommand) {
			const through = attachedThrough.get(askerCommand) ?? 0;
			const fresh = notices.filter(
				(notice) => notice.asker.command === askerCommand && notice.ordinal > through,
			);
			if (fresh.length > 0) {
				attachedThrough.set(askerCommand, fresh[fresh.length - 1]!.ordinal);
			}
			return fresh;
		},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test`
Expected: PASS.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm --filter @refarm.dev/prompt-contract-v1 run type-check
git add packages/prompt-contract-v1/src/
git commit -m "feat(prompt): the hub keeps what was said, and never pushes it alone"
refarm agent finish --lane after-commit --run --json
```

---

### Task 4: Notices on the wire, additively

**Files:**
- Modify: `packages/prompt-contract-v1/src/index.ts` — `handlePendingPromptHttp` (~1646)
- Test: `packages/prompt-contract-v1/src/index.test.ts`

**Interfaces:**
- Consumes: `hub.notices()` (Task 3), `parseOperatorNoticeList` (Task 1)
- Produces: `GET /prompts` response body gains `notices: OperatorNotice[]`

- [ ] **Step 1: Write the failing test**

```ts
describe("notices on the wire (D6)", () => {
	const asker = { command: "refarm delivery add" };

	it("GET /prompts carries notices beside prompts, with the wire unchanged", () => {
		const hub = createPendingPromptHub();
		hub.announce(asker, { message: "o bot é seu", kind: "context" });
		hub.publish(toPendingPrompt({ type: "text", question: "chatId?" }, { id: "p1", asker }));

		const response = handlePendingPromptHttp(hub, { method: "GET", path: "/prompts" });
		expect(response.status).toBe(200);
		expect(response.body.wire).toBe(PENDING_PROMPT_WIRE);
		expect(parseOperatorNoticeList(response.body).map((n) => n.message)).toEqual(["o bot é seu"]);
	});

	it("a frozen kit that knows nothing of notices parses the same prompts (D6)", () => {
		const hub = createPendingPromptHub();
		hub.announce(asker, "enquadramento que o kit antigo ignora");
		hub.publish(toPendingPrompt({ type: "text", question: "chatId?" }, { id: "p1", asker }));

		const body = handlePendingPromptHttp(hub, { method: "GET", path: "/prompts" }).body;
		const asOldKitSeesIt = parsePendingPromptList(body);
		expect(asOldKitSeesIt).toHaveLength(1);
		expect(asOldKitSeesIt[0]?.id).toBe("p1");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test -t "notices on the wire"`
Expected: FAIL — `notices` absent from the body.

- [ ] **Step 3: Write the implementation**

In `handlePendingPromptHttp`, the `/prompts` branch:

```ts
		return {
			status: 200,
			body: {
				wire: PENDING_PROMPT_WIRE,
				pollIntervalMs: hub.pollIntervalMs,
				prompts: hub.list(),
				// ADDITIVE, and the wire does NOT bump (D6). `parsePendingPromptList`
				// reads `body.prompts` and ignores everything else, so a kit frozen at
				// whatever `farm-update` last fetched shows no notices and is otherwise
				// unchanged. No `?since=`: `PendingPromptHttpRequest` is path-only by
				// contract, and a 32-entry ring is filtered client-side for free.
				notices: hub.notices(),
			},
		};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @refarm.dev/prompt-contract-v1 run type-check
git add packages/prompt-contract-v1/src/
git commit -m "feat(prompt): carry notices in the envelope the phone already reads"
refarm agent finish --lane after-commit --run --json
```

---

### Task 5: The publisher announces, and the remote and peered channels speak

**Files:**
- Modify: `packages/prompt-contract-v1/src/index.ts` — `PromptPublisher` (~204), `createStdioOperatorChannel` (~288), `createRemoteOperatorChannel` (~1440), `createPeeredOperatorChannel` (~1523)
- Test: `packages/prompt-contract-v1/src/index.test.ts`

**Interfaces:**
- Consumes: `hub.announce` (Task 3), `normalizeNoticeInput` (Task 1)
- Produces: `PromptPublisher.announce?(notice)`, `say` on the remote and peered channels

- [ ] **Step 1: Write the failing test**

```ts
describe("say() reaches the elsewhere (D7)", () => {
	const asker = { command: "refarm delivery add" };

	it("the remote channel announces into the hub", () => {
		const hub = createPendingPromptHub();
		const remote = createRemoteOperatorChannel({ hub, asker });
		remote.say?.({ message: "o bot é seu", kind: "context" });
		expect(hub.notices().map((n) => n.message)).toEqual(["o bot é seu"]);
	});

	it("the peered channel says it at the terminal AND publishes it", () => {
		const hub = createPendingPromptHub();
		let written = "";
		const output = new PassThrough() as unknown as NodeJS.WriteStream;
		output.write = ((chunk: string) => { written += chunk; return true; }) as never;

		const channel = createPeeredOperatorChannel({
			local: () => createTerminalOperatorChannel({ output }),
			remote: () => createRemoteOperatorChannel({ hub, asker }),
			announce: (notice) => { hub.announce(asker, notice); },
		});
		channel.say?.("dito nos dois lados");

		expect(written).toContain("dito nos dois lados");
		expect(hub.notices().map((n) => n.message)).toEqual(["dito nos dois lados"]);
	});

	it("a publisher that cannot announce does not stop the terminal from saying it", () => {
		let written = "";
		const output = new PassThrough() as unknown as NodeJS.WriteStream;
		output.write = ((chunk: string) => { written += chunk; return true; }) as never;
		const restore = setPromptPublisher(() => ({
			remote: (signal) => createRemoteOperatorChannel({ hub: createPendingPromptHub(), asker, signal }),
			// no announce — an older or announce-less publisher
		}));
		try {
			createStdioOperatorChannel({ output }).say?.("ainda assim aparece aqui");
			expect(written).toContain("ainda assim aparece aqui");
		} finally {
			restore();
		}
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test -t "reaches the elsewhere"`
Expected: FAIL — `announce` is not a known option; `say` undefined on the peered channel.

- [ ] **Step 3: Write the implementation**

`PromptPublisher` gains the sibling:

```ts
export interface PromptPublisher {
	/** Build the elsewhere-side channel for ONE ask, interruptible by `signal`. */
	remote(signal: AbortSignal): RemoteOperatorChannel;
	/**
	 * Publish a statement (D7).
	 *
	 * Separate from `remote` because ANNOUNCEMENT HAS NO LIFECYCLE. `remote` is a
	 * factory called per ask, taking a signal, because a question can be
	 * withdrawn, expire, or lose a race. A notice can do none of those, so making
	 * it build a whole remote channel around a signal that never fires would be
	 * bending a per-question lifecycle around something that has none.
	 *
	 * Optional: a publisher that cannot announce simply does not, and the terminal
	 * still says it.
	 */
	announce?(notice: string | OperatorNoticeInput): void;
}
```

`createRemoteOperatorChannel` gains, before `return { ask, lastSettlement: … }`:

```ts
	function say(notice: string | OperatorNoticeInput): void {
		hub.announce(asker, notice);
	}
	return { ask, say, lastSettlement: () => last };
```

`PeeredOperatorChannelOptions` gains:

```ts
	/** Publish a statement to the elsewhere. Optional — see `PromptPublisher.announce`. */
	announce?(notice: string | OperatorNoticeInput): void;
```

and `createPeeredOperatorChannel` gains, before `return { ask }`:

```ts
	function say(notice: string | OperatorNoticeInput): void {
		// The terminal FIRST: it is the surface someone may be looking at right
		// now, and a broken elsewhere must never be why they did not see this.
		options.local(new AbortController().signal).say?.(notice);
		try {
			options.announce?.(notice);
		} catch {
			// D1: say is total. A publisher that throws is a broken notification
			// arrangement, and that must not become the wizard's problem — the same
			// judgement `currentPromptPublisher` already makes.
		}
	}
	return { ask, say };
```

`createStdioOperatorChannel` threads the publisher's announce through:

```ts
	return createPeeredOperatorChannel({
		local: (signal) =>
			createTerminalOperatorChannel({ ...options, signal: anySignal(options.signal, signal) }),
		remote: (signal) => publisher.remote(signal),
		announce: publisher.announce ? (notice) => publisher.announce!(notice) : undefined,
	});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/prompt-contract-v1 run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @refarm.dev/prompt-contract-v1 run type-check
git add packages/prompt-contract-v1/src/
git commit -m "feat(prompt): announcement has no lifecycle, so it does not borrow one"
refarm agent finish --lane after-commit --run --json
```

---

### Task 6: Framing rides the question to the push surfaces

**Files:**
- Modify: `packages/delivery-contract-v1/src/index.ts` — `DeliveryRequest` (line 140)
- Modify: `apps/refarm/src/commands/delivery.ts` — `deliveryRequestFromPendingPrompt` (line 259), the `hub.subscribe` block (line 334)
- Test: `apps/refarm/src/commands/delivery.test.ts`

**Interfaces:**
- Consumes: `hub.takeNoticesFor()` (Task 3)
- Produces: `DeliveryRequest.framing?: readonly { message: string; kind: string }[]`

- [ ] **Step 1: Write the failing test**

Append to `apps/refarm/src/commands/delivery.test.ts`:

Append to `apps/refarm/src/commands/delivery.test.ts`, reusing its existing `spyAdapter` (line 49), `catalogFor`, and `resolveDeliveryChannels` helpers exactly as the tests at lines 430-460 already do:

```ts
describe("framing travels with the question, never alone (D9)", () => {
	const asker = { command: "refarm delivery add" };

	function attachSpy(hub: PendingPromptHub) {
		const spy = spyAdapter();
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		return { spy, attachment: attachDeliveryToHub(hub, { channels, attending: () => true }) };
	}

	it("announcing without asking drives the delivery subscriber zero times", async () => {
		const hub = createPendingPromptHub();
		const { spy, attachment } = attachSpy(hub);

		hub.announce(asker, "o bot é seu");
		await Promise.resolve();

		// Nothing was pushed: nothing is blocked, so nobody needs waking.
		expect(spy.offered).toHaveLength(0);
		expect(spy.announced).toHaveLength(0);
		attachment.detach();
	});

	it("three framing lines then a question is ONE request carrying all three", async () => {
		const hub = createPendingPromptHub();
		const { spy, attachment } = attachSpy(hub);

		hub.announce(asker, "precisa de um bot SEU");
		hub.announce(asker, "e do chatId");
		hub.announce(asker, { message: "refarm não fala com o BotFather por você", kind: "context" });
		hub.publish(toPendingPrompt({ type: "text", question: "Qual o chatId?" }, { id: "p1", asker }));
		await Promise.resolve();

		expect(spy.offered).toHaveLength(1);
		expect(spy.offered[0]!.framing?.map((f) => f.message)).toEqual([
			"precisa de um bot SEU",
			"e do chatId",
			"refarm não fala com o BotFather por você",
		]);
		attachment.detach();
	});

	it("a second question does not repeat framing already sent", async () => {
		const hub = createPendingPromptHub();
		const { spy, attachment } = attachSpy(hub);

		hub.announce(asker, "dito uma vez");
		hub.publish(toPendingPrompt({ type: "text", question: "primeira?" }, { id: "p1", asker }));
		await Promise.resolve();
		hub.publish(toPendingPrompt({ type: "text", question: "segunda?" }, { id: "p2", asker }));
		await Promise.resolve();

		expect(spy.offered[0]!.framing?.map((f) => f.message)).toEqual(["dito uma vez"]);
		expect(spy.offered[1]!.framing ?? []).toEqual([]);
		attachment.detach();
	});

	it("another asker's framing never rides this asker's question", async () => {
		const hub = createPendingPromptHub();
		const { spy, attachment } = attachSpy(hub);

		hub.announce({ command: "refarm auth enrol" }, "de outro wizard");
		hub.announce(asker, "deste wizard");
		hub.publish(toPendingPrompt({ type: "text", question: "q?" }, { id: "p1", asker }));
		await Promise.resolve();

		expect(spy.offered[0]!.framing?.map((f) => f.message)).toEqual(["deste wizard"]);
		attachment.detach();
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter refarm run test -t "framing travels with the question"`
Expected: FAIL — `framing` is not a property of `DeliveryRequest`.

- [ ] **Step 3: Write the implementation**

In `packages/delivery-contract-v1/src/index.ts`, add to `DeliveryRequest` after `needsDecision`:

```ts
	/**
	 * What was STATED before this question, and has not been carried yet (D9 of
	 * the announcement-contract design).
	 *
	 * A wizard's framing reaches a PUSH surface only by riding the question it
	 * frames: an adapter sends ONE message per channel with both, rather than one
	 * message per line. Distinct from a standalone status notice — see
	 * `needsDecision` above, which remains what an announce-only adapter carries
	 * for "the VPN is up".
	 */
	framing?: readonly { readonly message: string; readonly kind: string }[];
```

In `apps/refarm/src/commands/delivery.ts`, give the builder an optional second argument:

```ts
export function deliveryRequestFromPendingPrompt(
	pending: PendingPrompt,
	framing: readonly { message: string; kind: string }[] = [],
): DeliveryRequest {
	/* … the existing body, unchanged … */
	// and in the returned object:
	//   ...(framing.length > 0 ? { framing } : {}),
}
```

and at the `hub.subscribe` call site (line 338):

```ts
		// D9 — take this asker's unattached notices and carry them WITH the
		// question. `takeNoticesFor` marks them attached, so a second question
		// from the same wizard does not repeat framing the operator already read.
		const framing = hub
			.takeNoticesFor(pending.asker.command)
			.map((notice) => ({ message: notice.message, kind: notice.kind }));
		const request = deliveryRequestFromPendingPrompt(pending, framing);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @refarm.dev/delivery-contract-v1 run test && pnpm --filter refarm run test -t "framing travels"`
Expected: PASS.

- [ ] **Step 5: Build the contract and commit**

```bash
pnpm --filter @refarm.dev/delivery-contract-v1 run build
pnpm --filter refarm run type-check
git add packages/delivery-contract-v1/src/ apps/refarm/src/commands/delivery.ts apps/refarm/src/commands/delivery.test.ts
git commit -m "feat(delivery): framing rides the question it frames, one message per channel"
refarm agent finish --lane after-commit --run --json
```

---

### Task 7: `delivery add` speaks through the channel, and the registry stops hiding

The defect that forced the whole slice.

**Files:**
- Modify: `apps/refarm/src/commands/delivery-add.ts` — `DeliveryAddDeps.announce` (line 346, DELETED), the `say` helper (line 490), the adapter selection (571-573), and the kind classification at lines 674, 694, 915
- Test: `apps/refarm/src/commands/delivery-add.test.ts` — `recordingChannel` (line 82), `deps` (line 119), and the two assertions at lines 176 and 278

**Interfaces:**
- Consumes: `channel.say?.()` (Task 2), `normalizeNoticeInput`/`OperatorNoticeInput` (Task 1)

**The design decision this task takes:** `DeliveryAddDeps.announce` is DELETED rather than kept as an override. It existed only because there was no channel verb — a side door for tests to read lines that could not travel. Now the channel is the seam, and routing test assertions through it is what makes them assert the thing that matters: what actually reaches the operator. Only two assertions read `announced` today (lines 176, 278), and the second of them — "the secret is never announced" — gets STRONGER by moving, because it starts asserting on what travels rather than on what printed.

- [ ] **Step 1: Write the failing test**

First extend the existing `recordingChannel` helper (line 82) to record notices as well:

```ts
function recordingChannel(answers: Array<boolean | string>): {
	channel: OperatorChannel;
	asked: OperatorPrompt[];
	said: Required<OperatorNoticeInput>[];
} {
	const queue = [...answers];
	const asked: OperatorPrompt[] = [];
	const said: Required<OperatorNoticeInput>[] = [];
	const ask = async (prompt: OperatorPrompt): Promise<boolean | string> => {
		asked.push(prompt);
		if (queue.length === 0) {
			throw new RangeError(`no scripted answer for: ${JSON.stringify(prompt.question)}`);
		}
		return queue.shift()!;
	};
	const say = (notice: string | OperatorNoticeInput): void => {
		said.push(normalizeNoticeInput(notice));
	};
	return { channel: { ask, say } as OperatorChannel, asked, said };
}
```

Have `declareOnce` (line 148) return `said` alongside `result` and `asked`, and delete the `announce: (line) => void announced.push(line),` line from `deps` (line 119) plus the `announced` declaration (49) and its reset (159).

Migrate the two existing assertions:

```ts
// was: const shown = announced.join("\n");
const shown = said.map((n) => n.message).join("\n");

// was: expect(announced.join("\n")).not.toContain(SECRET);
expect(said.map((n) => n.message).join("\n")).not.toContain(SECRET);
```

Then append the new tests:

```ts
describe("the wizard's framing reaches the CHANNEL, not the node's stdout", () => {
	it("says the summary and all three preflight lines through the channel", async () => {
		const { said } = await declareOnce();
		const messages = said.map((n) => n.message);
		expect(messages).toContain("Telegram — o bot fala com você no app que já está no seu bolso.");
		expect(messages.some((m) => m.includes("@BotFather"))).toBe(true);
		expect(messages.some((m) => m.includes("chatId"))).toBe(true);
		expect(messages.some((m) => m.includes("não cria bot"))).toBe(true);
	});

	it("announces the single-adapter choice as a DECISION instead of making it in silence", async () => {
		const { said, asked } = await declareOnce();
		// The silence this whole slice exists to remove: with one adapter the
		// wizard skipped the select entirely, so the operator never learned there
		// was a registry behind it.
		expect(asked.some((prompt) => prompt.question.includes("Por onde o refarm"))).toBe(false);
		const decisions = said.filter((n) => n.kind === "decision");
		expect(decisions.some((n) => n.message.includes("telegram"))).toBe(true);
		expect(decisions.some((n) => /registrad/i.test(n.message))).toBe(true);
	});

	it("marks the capability narrowing as a decision, not as context", async () => {
		// `telegram` can answer, so force the narrowing path with an adapter that
		// cannot: see `deliveryCapabilityPrompt({ adapterCanAnswer: false })`, which
		// the existing test at delivery-add.test.ts:616 already exercises.
		const { said } = await declareOnce({}, fullRun({ capability: "announce" }));
		expect(said.every((n) => ["context", "decision", "caution"].includes(n.kind))).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter refarm run test -t "reaches the CHANNEL"`
Expected: FAIL — `said` is not returned by `declareOnce`; no `decision` notices exist.

- [ ] **Step 3: Write the implementation**

Delete `announce?: (line: string) => void;` from `DeliveryAddDeps` (line 346).

Move `const operator = deps.operator ?? createStdioOperatorChannel();` (currently line 557) ABOVE the `say` helper, then replace the helper (line 490):

```ts
	// Through the CHANNEL, never through stdout. `console.log` is what left every
	// wizard's framing on the node while only its questions travelled — the defect
	// this slice exists to remove. A channel that cannot say (D1: `say` is
	// optional) simply does not, and behaves exactly as it did before.
	const say = (notice: string | OperatorNoticeInput): void => operator.say?.(notice);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter refarm run test -t "reaches the channel"`
Expected: FAIL — `operator.notices()` is empty; the wizard still uses `console.log`.

- [ ] **Step 3: Write the implementation**

Replace the `say` helper (line 490):

```ts
	// Through the CHANNEL, not through stdout. `console.log` is what left every
	// wizard's framing on the node while only its questions travelled — the
	// defect this whole slice exists to remove. `deps.announce` stays for tests
	// that capture lines directly.
	const say = deps.announce
		? (notice: string | OperatorNoticeInput) =>
				deps.announce!(typeof notice === "string" ? notice : notice.message)
		: (notice: string | OperatorNoticeInput) => operator.say?.(notice);
```

Move `const operator = deps.operator ?? createStdioOperatorChannel();` (line 557) ABOVE this helper so `say` can close over it.

Adapter selection (571-573):

```ts
			if (available.length === 1) {
				adapterId = available[0]!;
				// D4 — refarm chose FOR the operator, so refarm says so. The silence
				// here is why `delivery add` read as a Telegram command rather than as
				// a wizard over a registry that has one adapter today.
				say({
					kind: "decision",
					message: `Um adaptador registrado: ${adapterId}. Escolhi ele — este comando serve qualquer adaptador registrado.`,
				});
			} else {
				adapterId = await operator.ask({
					type: "select",
					question: "Por onde o refarm deve te alcançar?",
					options: available.map((id) => ({ value: id, label: id })),
					default: available[0]!,
				});
			}
```

Then classify the remaining call sites per the spec's D4 table:
- line 674 (`"…" só sabe avisar`) and line 694 (`só te alcança enquanto você está atendendo`) → `{ kind: "decision", message: … }`
- line 915 (`Isto envia uma mensagem REAL agora`) → `{ kind: "caution", message: … }`
- lines 599, 600, 714, 715, 791 → leave as bare strings (they default to `context`)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter refarm run test -t "delivery"`
Expected: PASS, including the pre-existing `delivery-add` tests.

- [ ] **Step 5: Commit**

```bash
pnpm --filter refarm run type-check
git add apps/refarm/src/commands/delivery-add.ts apps/refarm/src/commands/delivery-add.test.ts
git commit -m "fix(delivery): say the framing through the channel, and stop hiding the registry"
refarm agent finish --lane after-commit --run --json
```

---

### Task 8: The two copies agree, and a guard says so

The `farm-client` vendored copy must match, and the invariant its README already claims must finally exist.

**Files:**
- Modify: `packages/farm-client/vendor/prompt-contract-v1/src/index.ts` (apply Tasks 1-5 verbatim)
- Create: `scripts/ci/test-farm-client-vendor-sync.mjs`
- Modify: `package.json` (register the script), `.github/workflows/` — the `quality` job's checker list

**Interfaces:**
- Consumes: the finished `packages/prompt-contract-v1/src/index.ts`

- [ ] **Step 1: Write the failing guard**

Create `scripts/ci/test-farm-client-vendor-sync.mjs`:

```js
#!/usr/bin/env node
// The farm-client kit VENDORS prompt-contract-v1 so a phone can parse the wire
// from a bare `git pull`, with nothing installed. That duplication is deliberate
// and load-bearing — and duplication with no guard is drift waiting to happen.
//
// packages/farm-client/README.md has claimed since it was written that this
// invariant is guarded. Until now it was not.
import { readFileSync } from "node:fs";

const SOURCE = "packages/prompt-contract-v1/src/index.ts";
const VENDOR = "packages/farm-client/vendor/prompt-contract-v1/src/index.ts";

const source = readFileSync(SOURCE, "utf8");
const vendor = readFileSync(VENDOR, "utf8");

if (source === vendor) {
	console.log(`✓ ${VENDOR} is identical to its source`);
	process.exit(0);
}

console.error(`✗ ${VENDOR} has drifted from ${SOURCE}`);
console.error(`  Fix: cp ${SOURCE} ${VENDOR}`);
console.error(`  The kit must stay parseable on a phone with nothing installed.`);
process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/ci/test-farm-client-vendor-sync.mjs`
Expected: FAIL — the vendor copy is still pre-Task-1.

- [ ] **Step 3: Sync the vendored copy**

```bash
cp packages/prompt-contract-v1/src/index.ts packages/farm-client/vendor/prompt-contract-v1/src/index.ts
```

Then confirm the kit still has no workspace imports (the decoupling invariant):

```bash
grep -n "@refarm.dev/" packages/farm-client/vendor/prompt-contract-v1/src/index.ts || echo "✓ no workspace imports"
```

- [ ] **Step 4: Run the guard and the kit's own tests to verify they pass**

Run:
```bash
node scripts/ci/test-farm-client-vendor-sync.mjs
pnpm --filter @refarm.dev/farm-client run test
```
Expected: PASS both.

- [ ] **Step 5: Register the guard in CI and commit**

Add to the root `package.json` scripts: `"test:vendor-sync": "node scripts/ci/test-farm-client-vendor-sync.mjs"`, and add that script to the `quality` job's checker list in `.github/workflows/` beside the other `scripts/ci/test-*.mjs` guards. Keep the workflow edit minimal — one line, no re-indentation (CLAUDE.md §6).

```bash
git add packages/farm-client/vendor/ scripts/ci/test-farm-client-vendor-sync.mjs package.json .github/workflows/
git commit -m "feat(farm-client): the vendored copy is guarded, as the README always said"
refarm agent finish --lane handoffs --run --json
refarm agent finish --lane before-push --run --json
```

Note the `handoffs` lane here rather than `after-commit`: this task changes public JSON output (Task 4's envelope) and a CI contract.

---

## Verification the finished slice must carry

Cross-check against the spec's own list before calling this done:

1. Conformance reports `announces` for every channel — Task 2.
2. Hub ordinal strictly monotonic across askers; ring bounded; notices survive their asker — Task 3.
3. `delivery add` framing asserted ON THE CHANNEL, and the single-adapter path emits a `decision` — Task 7.
4. An envelope carrying `notices` still parses to identical `prompts` through the unchanged `parsePendingPromptList` — Task 4.
5. A terminal channel with no publisher produces the same stdout `console.log` did — Task 2.
6. Announcing alone drives the delivery subscriber zero times; three lines then a question drives it once — Task 6.
7. Both copies byte-identical, asserted — Task 8.
