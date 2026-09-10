import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import {
	couldNotAttempt,
	delivered,
	refused,
	type DeliveryAdapter,
	type DeliveryAdapterFactory,
	type DeliveryRequest,
} from "@refarm.dev/delivery-contract-v1";
import {
	createStdioOperatorChannel,
	currentPromptPublisher,
	type OperatorChannel,
} from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askerForCommandPath, installDeclaredDelivery } from "./delivery-mount.js";

/**
 * THE LAST MILE, under test.
 *
 * `delivery.test.ts` proves the seam (catalog, routing, three outcomes) against a
 * hub a test constructed. This file proves the WIRING: that the refarm CLI mounts
 * that seam onto the channel every wizard already builds, that an operator who
 * declared nothing is running unchanged code, and that no notification failure
 * can reach the question.
 */

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

let workdir: string;
let mounts: Array<{ unmount(): void }>;

beforeEach(() => {
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-delivery-mount-"));
	mounts = [];
});

afterEach(() => {
	for (const mount of mounts) mount.unmount();
	fs.rmSync(workdir, { recursive: true, force: true });
	expect(currentPromptPublisher()).toBeNull();
});

function writeConfig(config: unknown): string {
	fs.mkdirSync(path.join(workdir, ".refarm"), { recursive: true });
	fs.writeFileSync(path.join(workdir, ".refarm", "config.json"), JSON.stringify(config));
	return workdir;
}

function declaring(overrides: Record<string, unknown> = {}): string {
	return writeConfig({
		delivery: {
			pocket: {
				adapter: "spy",
				capability: "answer",
				unattended: true,
				tokenEnv: "SPY_TOKEN",
				...overrides,
			},
		},
	});
}

/** A delivery adapter that touches no network and records what it was handed. */
function spyAdapter(
	options: {
		id?: string;
		capability?: "announce" | "answer";
		unattended?: boolean;
		announceOutcome?: (request: DeliveryRequest) => ReturnType<typeof delivered>;
		offerOutcome?: (request: DeliveryRequest) => ReturnType<typeof delivered>;
		throwOnOffer?: boolean;
	} = {},
) {
	const id = options.id ?? "spy";
	const capability = options.capability ?? "answer";
	const offered: DeliveryRequest[] = [];
	const announced: DeliveryRequest[] = [];
	let creations = 0;
	let sinkRef: { answer(value: string | boolean): boolean } | null = null;

	const adapter: DeliveryAdapter = {
		id,
		capability,
		unattended: options.unattended ?? true,
		async announce(request) {
			announced.push(request);
			return options.announceOutcome?.(request) ?? delivered(id, "announce", 1);
		},
	};
	if (capability === "answer") {
		adapter.offerAnswer = async (request, sink) => {
			offered.push(request);
			sinkRef = sink;
			if (options.throwOnOffer) throw new Error("socket hang up");
			return options.offerOutcome?.(request) ?? delivered(id, "answer", 1);
		};
	}

	const factory: DeliveryAdapterFactory = {
		id,
		create: () => {
			creations += 1;
			return adapter;
		},
	};
	return {
		factory,
		offered,
		announced,
		creations: () => creations,
		press: (value: string | boolean) => sinkRef?.answer(value) ?? false,
	};
}

/**
 * THE NODE, faked at the socket.
 *
 * `POST /prompts` is a LONG POLL: the node holds the request open for the whole
 * life of the question and answers it with the settlement. So a fake that returned
 * immediately would not be a fake of this route at all — every publish here stays
 * open until a test settles it, exactly as the daemon's does.
 *
 * Every mount below injects one of these. A test that fell through to the global
 * `fetch` would reach `http://127.0.0.1:42001` — the operator's LIVE daemon — and
 * publish real questions to real devices. The end-to-end run stands up its own
 * throwaway node on 439xx for that.
 */
interface FakeNodePublish {
	prompt: { type: string; question: string };
	asker: { command: string };
	timeoutMs: number;
	/** Settle it as an attending device would. */
	answer(value: unknown, device: string): void;
	/** The node's own deadline passing (P5). */
	expire(): void;
	/** True once the asker dropped the request — which is how the node withdraws. */
	aborted(): boolean;
}

function fakeNode(options: { fail?: () => Error } = {}) {
	const publishes: FakeNodePublish[] = [];
	const fetchImpl = (async (_url, init) => {
		if (options.fail) throw options.fail();
		const body = JSON.parse(String(init?.body)) as {
			prompt: FakeNodePublish["prompt"];
			asker: FakeNodePublish["asker"];
			timeoutMs: number;
		};
		let settle!: (payload: Record<string, unknown>) => void;
		let fail!: (error: unknown) => void;
		const open = new Promise<Record<string, unknown>>((resolve, reject) => {
			settle = resolve;
			fail = reject;
		});
		let aborted = false;
		const signal = init?.signal as AbortSignal | null | undefined;
		signal?.addEventListener(
			"abort",
			() => {
				aborted = true;
				const error = new Error("This operation was aborted");
				error.name = "AbortError";
				fail(error);
			},
			{ once: true },
		);
		publishes.push({
			prompt: body.prompt,
			asker: body.asker,
			timeoutMs: body.timeoutMs,
			answer: (value, device) => settle({ outcome: "answered", device, value }),
			expire: () => settle({ outcome: "abandoned", reason: "expired", device: " terminal" }),
			aborted: () => aborted,
		});
		const payload = await open;
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}) as typeof globalThis.fetch;
	return { fetch: fetchImpl, publishes };
}

/** What `createPeeredOperatorChannel` writes when the loser is told (P2). */
function captureStderr(): { lines: () => string[]; restore: () => void } {
	const lines: string[] = [];
	const spy = vi
		.spyOn(process.stderr, "write")
		.mockImplementation(((chunk: string | Uint8Array) => {
			lines.push(String(chunk));
			return true;
		}) as typeof process.stderr.write);
	return { lines: () => lines, restore: () => spy.mockRestore() };
}

/** A terminal that is not a terminal: enough for readline's line-based prompts. */
function fakeIo() {
	const input = new PassThrough() as PassThrough & NodeJS.ReadStream;
	const output = new PassThrough() as PassThrough & NodeJS.WriteStream;
	input.isTTY = false;
	output.isTTY = false;
	output.resume();
	return { input, output };
}

/**
 * A wizard. It knows about `OperatorChannel` and nothing else — no import, no
 * option, no channel name. Every assertion below drives THIS, unchanged.
 */
async function bringTheVpnUp(operator: OperatorChannel): Promise<boolean> {
	return operator.ask({ type: "confirm", question: "Bring the VPN up?" });
}

async function mount(options: Parameters<typeof installDeclaredDelivery>[0]) {
	// A mount with no injected node still gets a fake one, never the global fetch.
	const result = await installDeclaredDelivery({
		sidecarUrl: "http://127.0.0.1:1",
		fetch: fakeNode().fetch,
		...options,
	});
	mounts.push(result);
	return result;
}

/** Let the hub's synchronous publish, and the delivery promise chain, run. */
async function settleMicrotasks(): Promise<void> {
	for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

/**
 * Let a settled `POST /prompts` be read to completion.
 *
 * Reading a `Response` body is real I/O, not a microtask, so the node's reply
 * lands a turn of the event loop later than `settleMicrotasks` reaches.
 */
async function settleNode(): Promise<void> {
	for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ── D1 — undeclared delivery changes NOTHING ──────────────────────────────────

describe("D1 — an operator who declared no DELIVERY is running unchanged code", () => {
	it("brings up no channel and attaches nothing when there is no delivery block", async () => {
		const result = await mount({ asker: { command: "refarm auth enroll" }, root: workdir });
		expect(result.declared).toBe(false);
		expect(result.channels).toEqual([]);
		expect(result.attachment).toBeNull();
	});

	it("the wizard's question goes to the terminal and to the node, and to no channel", async () => {
		const node = fakeNode();
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			fetch: node.fetch,
			warn: (message) => warnings.push(message),
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));

		// The node's hub is NOT declaration-gated: the operator's attending devices
		// poll it whether or not a Telegram channel exists, and enrolling one of them
		// was the declaration. This is the join the defect was about.
		expect(node.publishes).toHaveLength(1);
		expect(node.publishes[0]!.prompt.question).toBe("Bring the VPN up?");
		expect(node.publishes[0]!.asker.command).toBe("refarm auth enroll");

		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		expect(warnings).toEqual([]);
	});

	it("does not even construct an adapter — undeclared delivery is inert, not merely quiet", async () => {
		const spy = spyAdapter();
		writeConfig({ surfaces: {}, workspaces: {} });
		const result = await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			factories: [spy.factory],
		});
		expect(spy.creations()).toBe(0);
		expect(result.attachment).toBeNull();
	});

	it("a config that cannot be read leaves the terminal working, and still reaches the node", async () => {
		fs.mkdirSync(path.join(workdir, ".refarm"), { recursive: true });
		fs.writeFileSync(path.join(workdir, ".refarm", "config.json"), "{ not json");
		const node = fakeNode();
		const warnings: string[] = [];
		const result = await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			fetch: node.fetch,
			warn: (message) => warnings.push(message),
		});
		// `loadRawSovereignConfig` returns null for a file it cannot parse rather than
		// throwing, so an unparseable config is indistinguishable from no declaration
		// at all — the catalog is empty and delivery stays silent. (The catalog-issue
		// path this file also covers is reached by a delivery block that parses and is
		// then rejected; see the unknown-adapter case below.)
		expect(result.declared).toBe(false);
		expect(result.attachment).toBeNull();
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		// D4 — a broken declaration costs the ANNOUNCEMENT, never the question: it is
		// still standing at the terminal and still on the pending-prompt wire.
		expect(node.publishes).toHaveLength(1);
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});

	it("a channel naming an unknown adapter is reported, and attaches nothing", async () => {
		writeConfig({
			delivery: { pigeon: { capability: "announce", unattended: false } },
		});
		const warnings: string[] = [];
		const result = await mount({
			asker: { command: "refarm auth enroll" },
			root: workdir,
			factories: [],
			warn: (message) => warnings.push(message),
		});
		expect(result.declared).toBe(true);
		expect(result.channels).toEqual([]);
		expect(result.attachment).toBeNull();
		expect(warnings.join()).toContain("pigeon");
	});

	it("a command that never prompts never touches the node", async () => {
		const node = fakeNode();
		await mount({ asker: { command: "refarm status" }, root: workdir, fetch: node.fetch });
		// `setPromptPublisher` takes a THUNK and the publish happens at `ask()`, so
		// mounting on every command costs a mount and not a socket.
		expect(node.publishes).toEqual([]);
	});
});

// ── D5 — the wizard gains reach with no code change ───────────────────────────

describe("D5 — the mount reaches a declared channel with no wizard change", () => {
	it("the question a wizard asked at the terminal also reaches the pocket", async () => {
		const spy = spyAdapter();
		const result = await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
			attending: () => false,
			env: { SPY_TOKEN: "irrelevant" },
		});
		expect(result.channels).toEqual(["pocket"]);

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();

		expect(spy.offered).toHaveLength(1);
		expect(spy.offered[0]!.question).toBe("Bring the VPN up?");
		expect(spy.offered[0]!.asker).toBe("refarm connection up");

		// …and the operator settles it from their pocket, never touching the terminal.
		expect(spy.press("true")).toBe(true);
		await expect(answer).resolves.toBe(true);
	});

	it("unmounting puts the process back exactly where it was", async () => {
		const spy = spyAdapter();
		const result = await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
		});
		expect(currentPromptPublisher()).not.toBeNull();
		result.unmount();
		result.unmount();
		expect(currentPromptPublisher()).toBeNull();

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		expect(spy.offered).toHaveLength(0);
	});

	it("the asker label is the invocation the operator would recognise", () => {
		expect(askerForCommandPath(["auth", "enroll"]).command).toBe("refarm auth enroll");
		expect(askerForCommandPath([]).command).toBe("refarm");
		expect(askerForCommandPath(["auth"]).pid).toBe(process.pid);
	});

	it("declaring delivery puts NO deadline on a prompt that never had one", async () => {
		const spy = spyAdapter();
		await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();
		// The remote peer must not carry `createRemoteOperatorChannel`'s ten-minute
		// default: a peered expiry ends BOTH sides, which would mean declaring a
		// notification channel silently timed out every terminal prompt.
		const pending = spy.offered[0]!;
		expect(pending.expiresAt).toBeNull();
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});
});

// ── D4 — a delivery failure never becomes a prompt failure ────────────────────

describe("D4 — the question survives every way delivery can fail", () => {
	it("a transport that REFUSES leaves the prompt answerable at the terminal", async () => {
		const spy = spyAdapter({
			offerOutcome: (request) => refused("spy", "answer", 1, `no chat for ${request.promptId}`),
		});
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
			warn: (message) => warnings.push(message),
		});

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		await settleMicrotasks();
		expect(warnings.join()).toContain("could not be delivered");
	});

	it("an adapter that THROWS leaves the prompt answerable on the wire", async () => {
		const spy = spyAdapter({ throwOnOffer: true });
		const warnings: string[] = [];
		const result = await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
			warn: (message) => warnings.push(message),
		});

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();

		// The question is still standing on the hub the attending kit reads.
		const pending = result.hub.list();
		expect(pending).toHaveLength(1);
		expect(result.hub.answer(pending[0]!.id, false, "my-phone").ok).toBe(true);
		await expect(answer).resolves.toBe(false);
		expect(warnings.join()).toContain("could not be delivered");
	});

	it("the three outcomes are distinguishable in the record", async () => {
		const cases: Array<{
			outcome: (request: DeliveryRequest) => ReturnType<typeof delivered>;
			status: string;
		}> = [
			{ outcome: () => delivered("spy", "answer", 1), status: "delivered" },
			{ outcome: () => refused("spy", "answer", 1, "chat not found"), status: "refused" },
			{ outcome: () => couldNotAttempt("spy", "answer", 1, "network unreachable"), status: "could-not-attempt" },
		];

		for (const testCase of cases) {
			const spy = spyAdapter({ offerOutcome: testCase.outcome });
			const result = await mount({
				asker: { command: "refarm connection up" },
				root: declaring(),
				factories: [spy.factory],
				warn: () => {},
			});
			const { input, output } = fakeIo();
			const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
			await settleMicrotasks();
			const promptId = result.hub.list()[0]!.id;
			await settleMicrotasks();

			const record = result.attachment!.recordFor(promptId);
			expect(record?.outcomes.map((entry) => entry.status)).toEqual([testCase.status]);
			expect(record?.reached).toBe(testCase.status === "delivered");

			result.hub.answer(promptId, true, "my-phone");
			await expect(answer).resolves.toBe(true);
			result.unmount();
		}
	});
});

// ── THE JOIN — the question reaches the hub the devices actually poll ─────────

describe("the CLI publishes to the node's hub, and the terminal stays a peer", () => {
	it("publishes the prompt the wizard asked, with the asker the operator would recognise", async () => {
		const node = fakeNode();
		await mount({
			asker: { command: "refarm connection up", pid: 4242, host: "farm" },
			root: workdir,
			fetch: node.fetch,
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));

		expect(node.publishes).toHaveLength(1);
		const published = node.publishes[0]!;
		expect(published.prompt).toEqual({ type: "confirm", question: "Bring the VPN up?" });
		expect(published.asker).toEqual({ command: "refarm connection up", pid: 4242, host: "farm" });
		// A prompt with no deadline of its own asks the node for the longest wait the
		// surface offers (`MAX_PROMPT_TIMEOUT_MS`), rather than acquiring the ten
		// minute default that would end the terminal prompt with it.
		expect(published.timeoutMs).toBe(60 * 60 * 1000);

		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});

	it("the terminal answers WITHOUT waiting on the node, and withdraws the question there", async () => {
		const node = fakeNode();
		await mount({ asker: { command: "refarm connection up" }, root: workdir, fetch: node.fetch });
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));

		// The node has the question and is still holding it: the operator at the
		// keyboard is not behind a round trip. Sitting at the desk stays the fastest
		// path, which is the whole of P2.
		expect(node.publishes).toHaveLength(1);
		expect(node.publishes[0]!.aborted()).toBe(false);

		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		await settleMicrotasks();

		// …and the question is gone from the node. Dropping the open publish is what
		// the daemon's `PromptTicket::drop` turns into a withdrawal, so a prompt
		// answered here is not still standing on the operator's phone.
		expect(node.publishes[0]!.aborted()).toBe(true);
	});

	it("an attending device answers first, and the terminal is told which one", async () => {
		const node = fakeNode();
		await mount({ asker: { command: "refarm connection up" }, root: workdir, fetch: node.fetch });
		const stderr = captureStderr();
		try {
			const { input, output } = fakeIo();
			const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
			await settleMicrotasks();

			node.publishes[0]!.answer(false, "my-phone");
			// The wizard gets the answer from the phone — the value crossed back over
			// the asker's own open request and nowhere else.
			await expect(answer).resolves.toBe(false);
			await settleMicrotasks();

			// P2 — the loser is told, and told WHERE. Silence is what leaves a prompt
			// hanging at a terminal someone is watching.
			expect(stderr.lines().join()).toContain("my-phone");
		} finally {
			stderr.restore();
		}
	});

	it("first answer wins: a device answering after the terminal changes nothing", async () => {
		const node = fakeNode();
		await mount({ asker: { command: "refarm connection up" }, root: workdir, fetch: node.fetch });
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));

		input.write("y\n");
		await expect(answer).resolves.toBe(true);
		await settleMicrotasks();

		// The late answer lands on a settled question. It must not resolve anything a
		// second time, and it must not throw into the CLI.
		expect(() => node.publishes[0]!.answer(false, "my-phone")).not.toThrow();
		await settleMicrotasks();
		await expect(answer).resolves.toBe(true);
	});

	it("a node that cannot be reached leaves the prompt at the terminal, and SAYS so", async () => {
		const node = fakeNode({
			fail: () => Object.assign(new Error("fetch failed"), { cause: "ECONNREFUSED" }),
		});
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm connection up" },
			root: workdir,
			sidecarUrl: "http://127.0.0.1:43999",
			fetch: node.fetch,
			warn: (message) => warnings.push(message),
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();

		// "Could not attempt", never silence — the operator is told the other
		// surfaces will not see this question, while they are still at the terminal.
		const said = warnings.join("\n");
		expect(said).toContain("http://127.0.0.1:43999");
		expect(said).toContain("this terminal only");
		expect(said).toContain("attending devices will not see it");

		// And the question itself is untouched: the daemon being down is not allowed
		// to be the reason a wizard cannot ask.
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});

	it("says it once per mount, not once per question", async () => {
		const node = fakeNode({ fail: () => new Error("fetch failed") });
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm init" },
			root: workdir,
			fetch: node.fetch,
			warn: (message) => warnings.push(message),
		});
		for (const reply of ["y\n", "y\n", "y\n"]) {
			const { input, output } = fakeIo();
			const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
			await settleMicrotasks();
			input.write(reply);
			await expect(answer).resolves.toBe(true);
		}
		// A wizard asks eight questions. An operator whose node is down needs to be
		// told that, not told it eight times.
		expect(warnings).toHaveLength(1);
	});

	it("a node that REFUSES the publish is reported, and the terminal still works", async () => {
		const refusing = (async () =>
			new Response(JSON.stringify({ error: "too-many-pending" }), {
				status: 429,
			})) as typeof globalThis.fetch;
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm connection up" },
			root: workdir,
			fetch: refusing,
			warn: (message) => warnings.push(message),
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();
		expect(warnings.join()).toContain("HTTP 429");
		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});

	it("a deadline the ASKER never set does not end the terminal prompt", async () => {
		const node = fakeNode();
		const warnings: string[] = [];
		await mount({
			asker: { command: "refarm connection up" },
			root: workdir,
			fetch: node.fetch,
			warn: (message) => warnings.push(message),
		});
		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();

		// `POST /prompts` has no "wait forever" (P5), so the node's ceiling passing is
		// NOT the asker's deadline: it must never abort a terminal prompt that never
		// had one. Here it comes back instantly, which is below the renewal floor —
		// so it is reported rather than looped on, and the question stands.
		node.publishes[0]!.expire();
		await settleNode();
		expect(warnings.join()).toContain("expired the question immediately");

		input.write("y\n");
		await expect(answer).resolves.toBe(true);
	});

	it("a declared channel and the node see the SAME question", async () => {
		const spy = spyAdapter();
		const node = fakeNode();
		const result = await mount({
			asker: { command: "refarm connection up" },
			root: declaring(),
			factories: [spy.factory],
			fetch: node.fetch,
			attending: () => false,
			env: { SPY_TOKEN: "irrelevant" },
		});
		expect(result.channels).toEqual(["pocket"]);

		const { input, output } = fakeIo();
		const answer = bringTheVpnUp(createStdioOperatorChannel({ input, output }));
		await settleMicrotasks();

		// One question, one hub, three surfaces reading it.
		expect(node.publishes).toHaveLength(1);
		expect(spy.offered).toHaveLength(1);
		expect(spy.offered[0]!.question).toBe(node.publishes[0]!.prompt.question);

		// The pocket settles it, and the node is released.
		expect(spy.press("true")).toBe(true);
		await expect(answer).resolves.toBe(true);
		await settleMicrotasks();
		expect(node.publishes[0]!.aborted()).toBe(true);
	});
});

// ── D5 — THE ACCEPTANCE TEST, asserted on the real wizards ────────────────────

describe("D5 — no wizard gained a line about delivery", () => {
	/**
	 * The files the operator named as the measure of this design. Reading them is
	 * the only assertion that cannot be satisfied by a well-behaved mock: if
	 * delivery ever needs a wizard to cooperate, one of these paths grows the
	 * word, and this fails.
	 */
	const WIZARDS = [
		"apps/refarm/src/commands/auth.ts",
		"apps/refarm/src/commands/intention.ts",
		"apps/refarm/src/commands/init.ts",
		"apps/refarm/src/commands/sow.ts",
		"apps/refarm/src/commands/migrate.ts",
		"apps/refarm/src/credentials/model.ts",
		"apps/refarm/src/credentials/cloudflare.ts",
		"packages/operation-consent-v1/src/index.ts",
		"packages/farm-client/src/path-operation.mjs",
	];

	it.each(WIZARDS)("%s says nothing about delivery", (relative) => {
		const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
		expect(source.toLowerCase()).not.toContain("deliver");
	});

	it("and the wizards that ask still go through the ONE join point", () => {
		const asking = WIZARDS.filter((relative) => relative !== "apps/refarm/src/commands/intention.ts");
		const joined = asking.filter((relative) => {
			const source = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
			return source.includes("createStdioOperatorChannel") || source.includes("OperatorChannel");
		});
		// If a wizard ever stops building its channel this way, the mount stops
		// reaching it — silently. That would be the worst possible regression, so
		// the join point is asserted rather than assumed.
		expect(joined).toEqual(asking);
	});
});
