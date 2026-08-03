import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	delivered,
	DeliveryDeclarationError,
	refused,
	type DeliveryAdapter,
	type DeliveryAdapterFactory,
	type DeliveryRequest,
} from "@refarm.dev/delivery-contract-v1";
import {
	createPendingPromptHub,
	createRemoteOperatorChannel,
	type OperatorChannel,
	type PendingPromptHub,
} from "@refarm.dev/prompt-contract-v1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultDeliveryAdapterFactories } from "./delivery-adapters.js";
import {
	attachDeliveryToHub,
	deliveryChoicesFor,
	deliveryRequestFromPendingPrompt,
	loadDeclaredDelivery,
	operatorIsAttending,
	readDeliveryCatalog,
	resolveDeclaredToken,
	resolveDeliveryChannels,
} from "./delivery.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

let workdir: string;

beforeEach(() => {
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-delivery-"));
});

afterEach(() => {
	fs.rmSync(workdir, { recursive: true, force: true });
});

function writeConfig(config: unknown): string {
	fs.mkdirSync(path.join(workdir, ".refarm"), { recursive: true });
	fs.writeFileSync(path.join(workdir, ".refarm", "config.json"), JSON.stringify(config));
	return workdir;
}

/** A spy adapter. Records what it was asked to carry; touches no network. */
function spyAdapter(
	options: {
		id?: string;
		capability?: "announce" | "answer";
		unattended?: boolean;
		outcome?: (r: DeliveryRequest) => ReturnType<typeof delivered>;
	} = {},
) {
	const id = options.id ?? "telegram";
	const capability = options.capability ?? "answer";
	const announced: DeliveryRequest[] = [];
	const offered: DeliveryRequest[] = [];
	let sinkRef: { answer(v: string | boolean): boolean } | null = null;

	const adapter: DeliveryAdapter = {
		id,
		capability,
		unattended: options.unattended ?? true,
		async announce(request) {
			announced.push(request);
			return options.outcome?.(request) ?? delivered(id, "announce", 1);
		},
	};
	if (capability === "answer") {
		adapter.offerAnswer = async (request, sink) => {
			offered.push(request);
			sinkRef = sink;
			return options.outcome?.(request) ?? delivered(id, "answer", 1);
		};
	}

	const factory: DeliveryAdapterFactory = { id, create: () => adapter };
	return {
		adapter,
		factory,
		announced,
		offered,
		press: (value: string | boolean) => sinkRef?.answer(value) ?? false,
	};
}

function catalogFor(name: string, overrides: Record<string, unknown> = {}) {
	return readDeliveryCatalogFrom({
		delivery: {
			[name]: { capability: "answer", unattended: true, chatId: "1", tokenEnv: "T", ...overrides },
		},
	});
}

function readDeliveryCatalogFrom(config: unknown) {
	const root = writeConfig(config);
	return readDeliveryCatalog(root);
}

// ── Reading the declaration ───────────────────────────────────────────────────

describe("readDeliveryCatalog", () => {
	it("an absent delivery block declares nothing", () => {
		expect(readDeliveryCatalogFrom({ surfaces: {} }).size).toBe(0);
	});

	it("a missing config file declares nothing rather than exploding", () => {
		expect(readDeliveryCatalog(workdir).size).toBe(0);
	});

	it("reads the operator's declaration off disk", () => {
		const catalog = catalogFor("telegram");
		expect(catalog.get("telegram")?.capability).toBe("answer");
		expect(catalog.get("telegram")?.unattended).toBe(true);
	});
});

describe("loadDeclaredDelivery", () => {
	it("a malformed block becomes an ISSUE, not a crash of the command the operator ran", () => {
		const root = writeConfig({ delivery: { telegram: "yes please" } });
		const { channels, issues } = loadDeclaredDelivery({ root });
		expect(channels).toEqual([]);
		expect(issues[0]!.channel).toBe("(delivery)");
	});

	it("no declaration at all is silence, not an issue (D1)", () => {
		const root = writeConfig({});
		expect(loadDeclaredDelivery({ root })).toEqual({ channels: [], issues: [] });
	});
});

// ── The registry ──────────────────────────────────────────────────────────────

describe("the registry", () => {
	it("ships telegram, and nothing else knows an adapter list exists", () => {
		expect(defaultDeliveryAdapterFactories().map((f) => f.id)).toEqual(["telegram"]);
	});

	it("an undeclared registered adapter delivers NOTHING (D1)", () => {
		const root = writeConfig({ delivery: {} });
		expect(loadDeclaredDelivery({ root }).channels).toEqual([]);
	});

	it("a declared channel naming no registered adapter is refused, with the list", () => {
		const root = writeConfig({
			delivery: { pigeon: { capability: "announce", unattended: false } },
		});
		const { channels, issues } = loadDeclaredDelivery({ root });
		expect(channels).toEqual([]);
		expect(issues[0]!.detail).toContain("no delivery adapter named \"pigeon\"");
		expect(issues[0]!.detail).toContain("telegram");
	});

	it("binds a declared channel to its adapter by id", () => {
		const spy = spyAdapter();
		const { channels, issues } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		expect(issues).toEqual([]);
		expect(channels).toHaveLength(1);
		expect(channels[0]!.adapter.id).toBe("telegram");
	});

	it("lets a channel name differ from the adapter serving it", () => {
		const spy = spyAdapter();
		const catalog = readDeliveryCatalogFrom({
			delivery: {
				"my-pocket": { adapter: "telegram", capability: "answer", unattended: true, chatId: "1", tokenEnv: "T" },
			},
		});
		const { channels } = resolveDeliveryChannels(catalog, { factories: [spy.factory] });
		expect(channels[0]!.declaration.name).toBe("my-pocket");
		expect(channels[0]!.adapter.id).toBe("telegram");
	});
});

// ── S3 at resolution ──────────────────────────────────────────────────────────

describe("S3 — a channel may not be declared beyond its adapter", () => {
	it("REFUSES a declaration claiming answer over an announce-only adapter", () => {
		const spy = spyAdapter({ capability: "announce", id: "email" });
		const catalog = readDeliveryCatalogFrom({
			delivery: { email: { capability: "answer", unattended: true } },
		});
		const { channels, issues } = resolveDeliveryChannels(catalog, { factories: [spy.factory] });
		expect(channels).toEqual([]);
		expect(issues[0]!.detail).toContain("may not declare a capability it cannot enforce");
	});

	it("REFUSES a declaration claiming unattended over an attended-only adapter", () => {
		const spy = spyAdapter({ id: "termux", unattended: false });
		const catalog = readDeliveryCatalogFrom({
			delivery: { termux: { capability: "answer", unattended: true } },
		});
		const { channels, issues } = resolveDeliveryChannels(catalog, { factories: [spy.factory] });
		expect(channels).toEqual([]);
		expect(issues[0]!.detail).toContain("may not declare a capability it cannot enforce");
	});

	it("a refused channel is not returned as usable — a refusal is not a warning", () => {
		const bad = spyAdapter({ capability: "announce", id: "email" });
		const good = spyAdapter({ id: "telegram" });
		const catalog = readDeliveryCatalogFrom({
			delivery: {
				email: { capability: "answer", unattended: true },
				telegram: { capability: "answer", unattended: true, chatId: "1", tokenEnv: "T" },
			},
		});
		const { channels, issues } = resolveDeliveryChannels(catalog, {
			factories: [bad.factory, good.factory],
		});
		expect(channels.map((c) => c.declaration.name)).toEqual(["telegram"]);
		expect(issues).toHaveLength(1);
	});

	it("a factory that refuses its declaration becomes an issue, not a throw", () => {
		const factory: DeliveryAdapterFactory = {
			id: "telegram",
			create: () => {
				throw new DeliveryDeclarationError("telegram needs a chatId");
			},
		};
		const { channels, issues } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [factory],
		});
		expect(channels).toEqual([]);
		expect(issues[0]!.detail).toContain("chatId");
	});

	it("the real telegram factory refuses a declaration with no chatId", () => {
		const root = writeConfig({
			delivery: { telegram: { capability: "answer", unattended: true, tokenEnv: "T" } },
		});
		const { channels, issues } = loadDeclaredDelivery({ root });
		expect(channels).toEqual([]);
		expect(issues[0]!.detail).toContain("chatId");
	});
});

// ── The secret ────────────────────────────────────────────────────────────────

describe("the token is named in the declaration and resolved at use", () => {
	it("resolves from an environment variable NAMED by the declaration", async () => {
		const value = await resolveDeclaredToken({ kind: "env", name: "TG" }, { env: { TG: " abc " } });
		expect(value).toBe("abc");
	});

	it("resolves from a file PATH named by the declaration", async () => {
		const file = path.join(workdir, "tg.token");
		fs.writeFileSync(file, "123:SECRET\n");
		expect(await resolveDeclaredToken({ kind: "file", path: "tg.token" }, { root: workdir })).toBe(
			"123:SECRET",
		);
		expect(await resolveDeclaredToken({ kind: "file", path: file })).toBe("123:SECRET");
	});

	it("an unset variable, a missing file and an empty file all fail by NAME, never by value", async () => {
		await expect(resolveDeclaredToken({ kind: "env", name: "NOPE" }, { env: {} })).rejects.toThrow(
			/"NOPE" is empty or unset/,
		);
		await expect(
			resolveDeclaredToken({ kind: "file", path: "absent" }, { root: workdir }),
		).rejects.toThrow(/cannot read the token file/);
		fs.writeFileSync(path.join(workdir, "blank"), "   \n");
		await expect(
			resolveDeclaredToken({ kind: "file", path: "blank" }, { root: workdir }),
		).rejects.toThrow(/is empty/);
	});

	it("the resolved token never lands in the catalog or a resolved channel", () => {
		const secret = "123456:AAHverySecretBotToken";
		const spy = spyAdapter();
		const catalog = catalogFor("telegram");
		const { channels } = resolveDeliveryChannels(catalog, {
			factories: [spy.factory],
			env: { T: secret },
		});
		expect(JSON.stringify([...catalog.values()])).not.toContain(secret);
		expect(JSON.stringify(channels.map((c) => c.declaration))).not.toContain(secret);
	});

	it("a config carrying an inline token is REFUSED outright", () => {
		const root = writeConfig({
			delivery: {
				telegram: { capability: "answer", unattended: true, chatId: "1", token: "123:SECRET" },
			},
		});
		const { channels, issues } = loadDeclaredDelivery({ root });
		expect(channels).toEqual([]);
		expect(issues[0]!.detail).toContain("never contains one");
		expect(issues[0]!.detail).not.toContain("123:SECRET");
	});
});

// ── D8 — reading `refarm intention` ───────────────────────────────────────────

describe("operatorIsAttending — the window `refarm intention arm` declares", () => {
	function armAttention(scope: string, state: Record<string, unknown>): void {
		const dir = path.join(workdir, "operator-attention");
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, `${scope}.json`), JSON.stringify(state));
	}

	const withHome = <T>(run: () => T): T => {
		const previous = process.env.REFARM_HOME;
		process.env.REFARM_HOME = workdir;
		try {
			return run();
		} finally {
			if (previous === undefined) delete process.env.REFARM_HOME;
			else process.env.REFARM_HOME = previous;
		}
	};

	it("an ARMED window means the operator is attending", () => {
		armAttention("attention:demo", { armedAt: 1_000, windowMs: 5_000 });
		expect(
			withHome(() => operatorIsAttending({ scope: "attention:demo", now: () => 3_000 })),
		).toBe(true);
	});

	it("an EXPIRED window means they are not", () => {
		armAttention("attention:demo", { armedAt: 1_000, windowMs: 5_000 });
		expect(
			withHome(() => operatorIsAttending({ scope: "attention:demo", now: () => 90_000 })),
		).toBe(false);
	});

	it("no state file, and no scope at all, both mean not attending", () => {
		expect(withHome(() => operatorIsAttending({ scope: "attention:never" }))).toBe(false);
		const previous = process.env.REFARM_OPERATOR_ATTENTION_SCOPE;
		delete process.env.REFARM_OPERATOR_ATTENTION_SCOPE;
		try {
			expect(withHome(() => operatorIsAttending())).toBe(false);
		} finally {
			if (previous !== undefined) process.env.REFARM_OPERATOR_ATTENTION_SCOPE = previous;
		}
	});
});

// ── Projecting a prompt ───────────────────────────────────────────────────────

describe("projecting a pending prompt for delivery", () => {
	function pendingOf(prompt: Record<string, unknown>) {
		return {
			wire: "pending-prompt.v1" as const,
			id: "p-1",
			prompt: prompt as never,
			answerTravels: prompt.type === "secret",
			asker: { command: "refarm connection up" },
			askedAt: 0,
			expiresAt: null,
		};
	}

	it("a confirm becomes two buttons", () => {
		expect(deliveryChoicesFor(pendingOf({ type: "confirm", question: "Up?" }))).toEqual([
			{ value: "true", label: "Yes" },
			{ value: "false", label: "No" },
		]);
	});

	it("a select becomes its offered options", () => {
		const choices = deliveryChoicesFor(
			pendingOf({
				type: "select",
				question: "Which?",
				options: [{ value: "a", label: "Alpha" }],
			}),
		);
		expect(choices).toEqual([{ value: "a", label: "Alpha" }]);
	});

	it("text and secret offer NO buttons, which is what makes them announce-only", () => {
		expect(deliveryChoicesFor(pendingOf({ type: "text", question: "Name?" }))).toBeUndefined();
		expect(deliveryChoicesFor(pendingOf({ type: "secret", question: "Token?" }))).toBeUndefined();
	});

	it("the projection carries the question and asker, and no prompt object", () => {
		const request = deliveryRequestFromPendingPrompt(pendingOf({ type: "confirm", question: "Up?" }));
		expect(request.question).toBe("Up?");
		expect(request.asker).toBe("refarm connection up");
		expect(request.needsDecision).toBe(true);
		expect(Object.keys(request)).not.toContain("prompt");
	});
});

// ── D5 — THE ACCEPTANCE TEST ──────────────────────────────────────────────────

/**
 * A wizard. It knows about `OperatorChannel` and NOTHING about delivery: no
 * import, no option, no adapter, no channel name. If this function ever needs
 * to change for delivery to work, the design has failed.
 */
async function bringTheVpnUp(operator: OperatorChannel): Promise<boolean> {
	return operator.ask({ type: "confirm", question: "Bring the VPN up?" });
}

describe("D5 — a wizard gains delivery with no code change", () => {
	let hub: PendingPromptHub;

	beforeEach(() => {
		hub = createPendingPromptHub();
	});

	function channelFor(hubRef: PendingPromptHub): OperatorChannel {
		return createRemoteOperatorChannel({
			hub: hubRef,
			asker: { command: "refarm connection up" },
			timeoutMs: null,
		});
	}

	it("the wizard's question reaches a declared channel it has never heard of", async () => {
		const spy = spyAdapter();
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		const attachment = attachDeliveryToHub(hub, { channels, attending: () => false });

		const answer = bringTheVpnUp(channelFor(hub));
		await Promise.resolve();
		await Promise.resolve();

		expect(spy.offered).toHaveLength(1);
		expect(spy.offered[0]!.question).toBe("Bring the VPN up?");
		expect(spy.offered[0]!.asker).toBe("refarm connection up");

		// …and the operator settles it from their pocket.
		expect(spy.press("true")).toBe(true);
		expect(await answer).toBe(true);
		attachment.detach();
	});

	it("with NOTHING declared, the same wizard behaves exactly as it did before", async () => {
		const attachment = attachDeliveryToHub(hub, { channels: [], attending: () => true });
		const answer = bringTheVpnUp(channelFor(hub));
		await Promise.resolve();
		const pending = hub.list();
		expect(pending).toHaveLength(1);
		hub.answer(pending[0]!.id, true, "my-phone");
		expect(await answer).toBe(true);
		attachment.detach();
	});

	it("detaching stops delivery without touching the wizard", async () => {
		const spy = spyAdapter();
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		const attachment = attachDeliveryToHub(hub, { channels, attending: () => true });
		attachment.detach();

		const answer = bringTheVpnUp(channelFor(hub));
		await Promise.resolve();
		expect(spy.offered).toHaveLength(0);
		hub.answer(hub.list()[0]!.id, true, "my-phone");
		expect(await answer).toBe(true);
	});

	it("a broken adapter never breaks the wizard's question", async () => {
		const factory: DeliveryAdapterFactory = {
			id: "telegram",
			create: () => ({
				id: "telegram",
				capability: "answer",
				unattended: true,
				announce: async () => {
					throw new Error("socket hang up");
				},
				offerAnswer: async () => {
					throw new Error("socket hang up");
				},
			}),
		};
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), { factories: [factory] });
		const warnings: string[] = [];
		const attachment = attachDeliveryToHub(hub, {
			channels,
			attending: () => true,
			warn: (m) => warnings.push(m),
		});

		const answer = bringTheVpnUp(channelFor(hub));
		await new Promise((r) => setTimeout(r, 10));

		hub.answer(hub.list()[0]!.id, false, "my-phone");
		expect(await answer).toBe(false);
		expect(warnings.join()).toContain("could not be delivered");
		attachment.detach();
	});
});

// ── D3 and D8, end to end through the hub ─────────────────────────────────────

describe("D3 and D8 hold end-to-end, not just in the router", () => {
	it("D3 — an announce-only channel is never handed the wizard's decision", async () => {
		const spy = spyAdapter({ capability: "announce", id: "email" });
		const catalog = readDeliveryCatalogFrom({
			delivery: { email: { capability: "announce", unattended: true } },
		});
		const { channels } = resolveDeliveryChannels(catalog, { factories: [spy.factory] });
		const hub = createPendingPromptHub();
		const attachment = attachDeliveryToHub(hub, { channels, attending: () => true });

		void bringTheVpnUp(
			createRemoteOperatorChannel({ hub, asker: { command: "x" }, timeoutMs: null }),
		);
		await new Promise((r) => setTimeout(r, 10));

		expect(spy.announced).toHaveLength(1);
		expect(spy.offered).toHaveLength(0);
		const record = attachment.recordFor(hub.list()[0]?.id ?? "");
		expect(record?.refusals[0]?.reason).toBe("announce-only");
		attachment.detach();
	});

	it("D8 — an attended-only channel stays silent while nobody is attending", async () => {
		const spy = spyAdapter({ id: "termux", unattended: false });
		const catalog = readDeliveryCatalogFrom({
			delivery: { termux: { capability: "answer", unattended: false } },
		});
		const { channels } = resolveDeliveryChannels(catalog, { factories: [spy.factory] });
		const hub = createPendingPromptHub();
		let attending = false;
		const attachment = attachDeliveryToHub(hub, { channels, attending: () => attending, warn: () => {} });

		void bringTheVpnUp(
			createRemoteOperatorChannel({ hub, asker: { command: "x" }, timeoutMs: null }),
		);
		await new Promise((r) => setTimeout(r, 10));
		expect(spy.offered).toHaveLength(0);
		expect(spy.announced).toHaveLength(0);

		// The operator arms an attention window; the SAME channel now delivers.
		attending = true;
		void bringTheVpnUp(
			createRemoteOperatorChannel({ hub, asker: { command: "y" }, timeoutMs: null }),
		);
		await new Promise((r) => setTimeout(r, 10));
		expect(spy.offered).toHaveLength(1);
		attachment.detach();
	});
});

// ── D4 — the record an operator reads hours later ─────────────────────────────

describe("D4 — the outcome is recorded on the prompt", () => {
	async function recordAfter(outcome: (id: string) => ReturnType<typeof delivered>) {
		const spy = spyAdapter({ outcome: (r) => outcome(r.promptId) });
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		const hub = createPendingPromptHub();
		const attachment = attachDeliveryToHub(hub, {
			channels,
			attending: () => true,
			warn: () => {},
		});
		void bringTheVpnUp(
			createRemoteOperatorChannel({ hub, asker: { command: "x" }, timeoutMs: null }),
		);
		await new Promise((r) => setTimeout(r, 10));
		const id = hub.list()[0]!.id;
		return { record: attachment.recordFor(id), attachment };
	}

	it("a delivered question says so", async () => {
		const { record, attachment } = await recordAfter((id) => delivered("telegram", "answer", 1, id));
		expect(record?.reached).toBe(true);
		expect(record?.outcomes[0]!.status).toBe("delivered");
		attachment.detach();
	});

	it("a transport refusal is recorded as such, and is NOT 'delivered'", async () => {
		const { record, attachment } = await recordAfter(() =>
			refused("telegram", "answer", 1, "bot was blocked"),
		);
		expect(record?.reached).toBe(false);
		expect(record?.outcomes[0]!.status).toBe("refused");
		attachment.detach();
	});

	it("a failure to reach the operator is WRITTEN somewhere they will see it", async () => {
		const spy = spyAdapter({ outcome: () => refused("telegram", "answer", 1, "bot was blocked") });
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		const hub = createPendingPromptHub();
		const warnings: string[] = [];
		const attachment = attachDeliveryToHub(hub, {
			channels,
			attending: () => true,
			warn: (m) => warnings.push(m),
		});
		void bringTheVpnUp(
			createRemoteOperatorChannel({ hub, asker: { command: "x" }, timeoutMs: null }),
		);
		await new Promise((r) => setTimeout(r, 10));
		expect(warnings.join()).toContain("a question is waiting and could not be delivered");
		expect(warnings.join()).toContain("bot was blocked");
		attachment.detach();
	});

	it("a SUCCESSFUL delivery says nothing — the phone already buzzed", async () => {
		const spy = spyAdapter();
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		const hub = createPendingPromptHub();
		const warnings: string[] = [];
		const attachment = attachDeliveryToHub(hub, {
			channels,
			attending: () => true,
			warn: (m) => warnings.push(m),
		});
		void bringTheVpnUp(
			createRemoteOperatorChannel({ hub, asker: { command: "x" }, timeoutMs: null }),
		);
		await new Promise((r) => setTimeout(r, 10));
		expect(warnings).toEqual([]);
		attachment.detach();
	});

	it("records are bounded — an operator asks about the question in front of them", async () => {
		const spy = spyAdapter();
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		const hub = createPendingPromptHub();
		const attachment = attachDeliveryToHub(hub, {
			channels,
			attending: () => true,
			maxRecords: 2,
		});
		for (let i = 0; i < 5; i++) {
			void bringTheVpnUp(
				createRemoteOperatorChannel({ hub, asker: { command: `x${i}` }, timeoutMs: null }),
			);
		}
		await new Promise((r) => setTimeout(r, 20));
		expect(attachment.records()).toHaveLength(2);
		attachment.detach();
	});

	it("an answer from a delivery channel is attributed to the CHANNEL, never to a device", async () => {
		const spy = spyAdapter();
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		const hub = createPendingPromptHub();
		const attachment = attachDeliveryToHub(hub, { channels, attending: () => true });
		const answer = bringTheVpnUp(
			createRemoteOperatorChannel({ hub, asker: { command: "x" }, timeoutMs: null }),
		);
		await new Promise((r) => setTimeout(r, 10));
		const id = hub.list()[0]!.id;
		spy.press("true");
		await answer;
		expect(hub.settlementOf(id)?.device).toBe("delivery:telegram");
		attachment.detach();
	});
});

describe("framing travels with the question, never alone (D9)", () => {
	const asker = { command: "refarm delivery add" };

	function attachSpy(hub: PendingPromptHub) {
		const spy = spyAdapter();
		const { channels } = resolveDeliveryChannels(catalogFor("telegram"), {
			factories: [spy.factory],
		});
		return { spy, attachment: attachDeliveryToHub(hub, { channels, attending: () => true }) };
	}

	/**
	 * A wizard's question. `text` on purpose — it is what `delivery add` actually
	 * asks, and a free-text answer cannot be carried back by an adapter's choice
	 * mechanism, so the route DEGRADES TO ANNOUNCE. That is the common case, which
	 * makes it the one framing has to survive: an announce-mode request still has to
	 * carry the sentences that explain the question it announces.
	 */
	function ask(hub: PendingPromptHub, question: string): void {
		void createRemoteOperatorChannel({ hub, asker, timeoutMs: null }).ask({
			type: "text",
			question,
		});
	}

	/** Two turns: publish → subscribe → async deliver() → the adapter records. */
	async function drain(): Promise<void> {
		await Promise.resolve();
		await Promise.resolve();
	}

	it("announcing without asking drives the delivery subscriber zero times", async () => {
		const hub = createPendingPromptHub();
		const { spy, attachment } = attachSpy(hub);

		hub.announce(asker, "o bot é seu");
		await drain();

		// Nothing pushed: nothing is blocked, so nobody needs waking. Three preflight
		// lines must never become three Telegram messages.
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
		ask(hub, "Qual o chatId?");
		await drain();

		expect(spy.announced).toHaveLength(1);
		expect(spy.announced[0]!.framing?.map((f) => f.message)).toEqual([
			"precisa de um bot SEU",
			"e do chatId",
			"refarm não fala com o BotFather por você",
		]);
		attachment.detach();
	});

	it("a second question does not repeat framing already carried", async () => {
		const hub = createPendingPromptHub();
		const { spy, attachment } = attachSpy(hub);

		hub.announce(asker, "dito uma vez");
		ask(hub, "primeira?");
		await drain();
		ask(hub, "segunda?");
		await drain();

		expect(spy.announced[0]!.framing?.map((f) => f.message)).toEqual(["dito uma vez"]);
		expect(spy.announced[1]!.framing ?? []).toEqual([]);
		attachment.detach();
	});

	it("another wizard's framing never rides this wizard's question", async () => {
		const hub = createPendingPromptHub();
		const { spy, attachment } = attachSpy(hub);

		hub.announce({ command: "refarm auth enrol" }, "de outro wizard");
		hub.announce(asker, "deste wizard");
		ask(hub, "q?");
		await drain();

		expect(spy.announced[0]!.framing?.map((f) => f.message)).toEqual(["deste wizard"]);
		attachment.detach();
	});
});
