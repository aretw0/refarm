import { describe, expect, it } from "vitest";
import {
	assertNoSecretInDetail,
	buildDeliveryRecord,
	capabilitySatisfies,
	couldNotAttempt,
	delivered,
	deliver,
	DeliveryDeclarationError,
	describeDeliveryRecord,
	MAX_DELIVERY_CHANNELS,
	parseDeclaredTokenRef,
	parseDeliveryCatalog,
	refuseAnswerRouteToAnnounceOnly,
	refuseOverclaimedDeclaration,
	refuseUnenforceableAdapter,
	refused,
	resolveDeliveryMode,
	routeDelivery,
	scrubSecret,
	type DeliveryAdapter,
	type DeliveryDeclaration,
	type DeliveryOutcome,
	type DeliveryRequest,
	type ResolvedDeliveryChannel,
} from "./index.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function request(overrides: Partial<DeliveryRequest> = {}): DeliveryRequest {
	return {
		promptId: "p-1",
		question: "Bring the VPN up?",
		asker: "refarm connection up",
		needsDecision: true,
		answerTravels: false,
		expiresAt: null,
		...overrides,
	};
}

function declaration(overrides: Partial<DeliveryDeclaration> = {}): DeliveryDeclaration {
	return {
		name: "telegram",
		adapter: "telegram",
		capability: "answer",
		unattended: true,
		options: {},
		...overrides,
	};
}

interface FakeAdapterOptions {
	id?: string;
	capability?: "announce" | "answer";
	unattended?: boolean;
	announceOutcome?: (r: DeliveryRequest) => DeliveryOutcome | Promise<DeliveryOutcome>;
	answerOutcome?: (r: DeliveryRequest) => DeliveryOutcome | Promise<DeliveryOutcome>;
}

function fakeAdapter(options: FakeAdapterOptions = {}) {
	const id = options.id ?? "telegram";
	const capability = options.capability ?? "answer";
	const seen: Array<{ mode: string; request: DeliveryRequest }> = [];
	const adapter: DeliveryAdapter = {
		id,
		capability,
		unattended: options.unattended ?? true,
		async announce(r) {
			seen.push({ mode: "announce", request: r });
			return options.announceOutcome?.(r) ?? delivered(id, "announce", 1);
		},
	};
	if (capability === "answer") {
		adapter.offerAnswer = async (r, sink) => {
			seen.push({ mode: "answer", request: r });
			if (options.answerOutcome) return options.answerOutcome(r);
			sink.answer(true);
			return delivered(id, "answer", 1);
		};
	}
	return { adapter, seen };
}

function channel(
	adapter: DeliveryAdapter,
	overrides: Partial<DeliveryDeclaration> = {},
): ResolvedDeliveryChannel {
	return {
		adapter,
		declaration: declaration({
			name: adapter.id,
			adapter: adapter.id,
			capability: adapter.capability,
			unattended: adapter.unattended,
			...overrides,
		}),
	};
}

const noSink = { answer: () => true };

// ── D1 — the declared catalog ─────────────────────────────────────────────────

describe("parseDeliveryCatalog — D1, silence is closed", () => {
	it("an absent block declares nothing: refarm does not go looking for an adapter", () => {
		expect(parseDeliveryCatalog({}).size).toBe(0);
		expect(parseDeliveryCatalog({ delivery: undefined }).size).toBe(0);
		expect(parseDeliveryCatalog({ delivery: null }).size).toBe(0);
		expect(parseDeliveryCatalog(null).size).toBe(0);
		expect(parseDeliveryCatalog("nonsense").size).toBe(0);
	});

	it("parses a declared channel, defaulting the adapter id to the channel name", () => {
		const catalog = parseDeliveryCatalog({
			delivery: {
				telegram: { capability: "answer", unattended: true, chatId: "42", tokenFile: ".refarm/t" },
			},
		});
		const entry = catalog.get("telegram");
		expect(entry?.adapter).toBe("telegram");
		expect(entry?.capability).toBe("answer");
		expect(entry?.unattended).toBe(true);
		expect(entry?.options).toEqual({ chatId: "42", tokenFile: ".refarm/t" });
	});

	it("lets a channel name differ from the adapter that serves it", () => {
		const catalog = parseDeliveryCatalog({
			delivery: { "my-phone": { adapter: "telegram", capability: "answer", unattended: true } },
		});
		expect(catalog.get("my-phone")?.adapter).toBe("telegram");
	});

	it("is FAIL-SHUT: a present but malformed block throws rather than degrading", () => {
		expect(() => parseDeliveryCatalog({ delivery: [] })).toThrow(DeliveryDeclarationError);
		expect(() => parseDeliveryCatalog({ delivery: "telegram" })).toThrow(DeliveryDeclarationError);
		expect(() => parseDeliveryCatalog({ delivery: { telegram: 3 } })).toThrow(
			DeliveryDeclarationError,
		);
	});

	it("refuses a capability that is not announce or answer", () => {
		expect(() =>
			parseDeliveryCatalog({ delivery: { t: { capability: "shout", unattended: true } } }),
		).toThrow(/must be "announce" or "answer"/);
		expect(() => parseDeliveryCatalog({ delivery: { t: { unattended: true } } })).toThrow(
			/must be "announce" or "answer"/,
		);
	});

	it("refuses to GUESS attendance — unattended must be declared explicitly (D8)", () => {
		expect(() => parseDeliveryCatalog({ delivery: { t: { capability: "announce" } } })).toThrow(
			/"unattended" must be declared/,
		);
		expect(() =>
			parseDeliveryCatalog({ delivery: { t: { capability: "announce", unattended: "yes" } } }),
		).toThrow(/"unattended" must be declared/);
	});

	it("bounds the catalog rather than fanning out unboundedly", () => {
		const delivery: Record<string, unknown> = {};
		for (let i = 0; i <= MAX_DELIVERY_CHANNELS; i++) {
			delivery[`c${i}`] = { capability: "announce", unattended: true };
		}
		expect(() => parseDeliveryCatalog({ delivery })).toThrow(/at most 8/);
	});

	it("REFUSES an inline secret: a declaration names where a token comes from, never carries one", () => {
		for (const key of ["token", "botToken", "bot_token", "secret", "apiKey", "api_key", "password"]) {
			expect(() =>
				parseDeliveryCatalog({
					delivery: { telegram: { capability: "answer", unattended: true, [key]: "123:ABC" } },
				}),
			).toThrow(/never contains one/);
		}
	});

	it("the inline-secret refusal message never echoes the value it refused", () => {
		let message = "";
		try {
			parseDeliveryCatalog({
				delivery: { telegram: { capability: "answer", unattended: true, token: "123:SUPERSECRET" } },
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).not.toContain("SUPERSECRET");
		expect(message).toContain("tokenFile");
	});
});

describe("parseDeclaredTokenRef — a reference, resolved at use", () => {
	it("reads a file path", () => {
		expect(parseDeclaredTokenRef(declaration({ options: { tokenFile: " .refarm/t " } }))).toEqual({
			kind: "file",
			path: ".refarm/t",
		});
	});

	it("reads an env variable NAME", () => {
		expect(parseDeclaredTokenRef(declaration({ options: { tokenEnv: "TG_TOKEN" } }))).toEqual({
			kind: "env",
			name: "TG_TOKEN",
		});
	});

	it("refuses both, and refuses neither", () => {
		expect(() =>
			parseDeclaredTokenRef(declaration({ options: { tokenFile: "a", tokenEnv: "B" } })),
		).toThrow(/exactly one/);
		expect(() => parseDeclaredTokenRef(declaration({ options: {} }))).toThrow(/needs a secret/);
	});
});

// ── S3 — a thing may not declare a capability it cannot enforce ───────────────

describe("refuseUnenforceableAdapter — S3, structurally", () => {
	it("accepts an announce-only adapter with no offerAnswer", () => {
		const { adapter } = fakeAdapter({ capability: "announce" });
		expect(() => refuseUnenforceableAdapter(adapter)).not.toThrow();
	});

	it("accepts an answer adapter that implements offerAnswer", () => {
		const { adapter } = fakeAdapter({ capability: "answer" });
		expect(() => refuseUnenforceableAdapter(adapter)).not.toThrow();
	});

	it("REFUSES an adapter claiming answer with no offerAnswer implementation", () => {
		const { adapter } = fakeAdapter({ capability: "announce" });
		const liar: DeliveryAdapter = { ...adapter, capability: "answer" };
		expect(() => refuseUnenforceableAdapter(liar)).toThrow(
			/may not declare a capability it cannot enforce/,
		);
	});

	it("refuses an unknown capability and a non-boolean unattended", () => {
		const { adapter } = fakeAdapter();
		expect(() =>
			refuseUnenforceableAdapter({ ...adapter, capability: "shout" as never }),
		).toThrow(DeliveryDeclarationError);
		expect(() =>
			refuseUnenforceableAdapter({ ...adapter, unattended: "yes" as never }),
		).toThrow(DeliveryDeclarationError);
	});
});

describe("refuseOverclaimedDeclaration — S3 at the catalog boundary", () => {
	it("accepts a declaration within its adapter's means", () => {
		const { adapter } = fakeAdapter({ capability: "answer" });
		expect(() =>
			refuseOverclaimedDeclaration(declaration({ capability: "announce" }), adapter),
		).not.toThrow();
	});

	it("REFUSES declaring answer over an announce-only adapter", () => {
		const { adapter } = fakeAdapter({ capability: "announce", id: "email" });
		expect(() =>
			refuseOverclaimedDeclaration(declaration({ capability: "answer" }), adapter),
		).toThrow(/may not declare a capability it cannot enforce/);
	});

	it("REFUSES declaring unattended over an attended-only adapter (D8)", () => {
		const { adapter } = fakeAdapter({ unattended: false, id: "termux" });
		expect(() =>
			refuseOverclaimedDeclaration(declaration({ unattended: true }), adapter),
		).toThrow(/only\s+reaches you while you are attending/);
	});
});

describe("capabilitySatisfies", () => {
	it("answer subsumes announce; announce does not subsume answer", () => {
		expect(capabilitySatisfies("answer", "announce")).toBe(true);
		expect(capabilitySatisfies("answer", "answer")).toBe(true);
		expect(capabilitySatisfies("announce", "announce")).toBe(true);
		expect(capabilitySatisfies("announce", "answer")).toBe(false);
	});
});

// ── D3 — announce-only refusal ────────────────────────────────────────────────

describe("D3 — refarm refuses to route a decision to an announce-only channel", () => {
	it("routes a decision in ANSWER mode to an answer-capable channel", () => {
		const { adapter } = fakeAdapter({ capability: "answer" });
		const plan = routeDelivery({ request: request(), channels: [channel(adapter)], attending: true });
		expect(plan.routes).toHaveLength(1);
		expect(plan.routes[0]!.mode).toBe("answer");
		expect(plan.answerable).toBe(true);
		expect(plan.refusals).toEqual([]);
	});

	it("NEVER routes a decision in answer mode to an announce-only channel", () => {
		const { adapter } = fakeAdapter({ capability: "announce", id: "email" });
		const plan = routeDelivery({ request: request(), channels: [channel(adapter)], attending: true });
		expect(plan.routes[0]!.mode).toBe("announce");
		expect(plan.answerable).toBe(false);
	});

	it("LABELS the announce-only channel rather than dropping it silently", () => {
		const { adapter } = fakeAdapter({ capability: "announce", id: "email" });
		const plan = routeDelivery({ request: request(), channels: [channel(adapter)], attending: true });
		expect(plan.refusals).toHaveLength(1);
		expect(plan.refusals[0]!.reason).toBe("announce-only");
		expect(plan.refusals[0]!.channel).toBe("email");
		// Still announced: "there is a question waiting, go look" is real information.
		expect(plan.routes).toHaveLength(1);
	});

	it("a NOTICE needs no decision, so an announce-only channel serves it with no refusal", () => {
		const { adapter } = fakeAdapter({ capability: "announce", id: "email" });
		const plan = routeDelivery({
			request: request({ needsDecision: false }),
			channels: [channel(adapter)],
			attending: true,
		});
		expect(plan.routes[0]!.mode).toBe("announce");
		expect(plan.refusals).toEqual([]);
	});

	it("an announce-only adapter is never HANDED a decision at execution time", async () => {
		const { adapter, seen } = fakeAdapter({ capability: "announce", id: "email" });
		const plan = routeDelivery({ request: request(), channels: [channel(adapter)], attending: true });
		await deliver({ plan, request: request(), sink: noSink, now: () => 5 });
		expect(seen.map((s) => s.mode)).toEqual(["announce"]);
	});

	it("the hard guard throws if an answer route ever reaches an announce-only channel", () => {
		const { adapter } = fakeAdapter({ capability: "announce", id: "email" });
		expect(() =>
			refuseAnswerRouteToAnnounceOnly({
				channel: "email",
				adapter,
				declaration: declaration({ name: "email", capability: "announce" }),
				mode: "answer",
			}),
		).toThrow(/refusing to route a decision/);
	});

	it("the hard guard throws for an adapter with no offerAnswer, whatever it declared", () => {
		const { adapter } = fakeAdapter({ capability: "announce", id: "email" });
		expect(() =>
			refuseAnswerRouteToAnnounceOnly({
				channel: "email",
				adapter: { ...adapter, capability: "answer" },
				declaration: declaration({ name: "email", capability: "answer" }),
				mode: "answer",
			}),
		).toThrow(/implements no offerAnswer/);
	});

	it("P4 — an answer that would TRAVEL degrades to announce even on an answer channel", () => {
		const { adapter } = fakeAdapter({ capability: "answer" });
		const plan = routeDelivery({
			request: request({ answerTravels: true }),
			channels: [channel(adapter)],
			attending: true,
		});
		expect(plan.routes[0]!.mode).toBe("announce");
		expect(plan.refusals[0]!.reason).toBe("answer-would-travel");
	});

	it("resolveDeliveryMode is the whole decision, in isolation", () => {
		expect(resolveDeliveryMode(request(), declaration({ capability: "answer" }))).toBe("answer");
		expect(resolveDeliveryMode(request(), declaration({ capability: "announce" }))).toBe("announce");
		expect(
			resolveDeliveryMode(request({ needsDecision: false }), declaration({ capability: "answer" })),
		).toBe("announce");
		expect(
			resolveDeliveryMode(request({ answerTravels: true }), declaration({ capability: "answer" })),
		).toBe("announce");
	});
});

// ── D8 — attended and unattended ──────────────────────────────────────────────

describe("D8 — routing reads the attention window the operator already declares", () => {
	it("NOT attending: an unattended-capable channel still delivers", () => {
		const { adapter } = fakeAdapter({ unattended: true, id: "telegram" });
		const plan = routeDelivery({
			request: request(),
			channels: [channel(adapter)],
			attending: false,
		});
		expect(plan.routes).toHaveLength(1);
		expect(plan.refusals).toEqual([]);
	});

	it("NOT attending: an attended-only channel is REFUSED, not silently skipped", () => {
		const { adapter } = fakeAdapter({ unattended: false, id: "termux" });
		const plan = routeDelivery({
			request: request(),
			channels: [channel(adapter)],
			attending: false,
		});
		expect(plan.routes).toEqual([]);
		expect(plan.refusals).toHaveLength(1);
		expect(plan.refusals[0]!.reason).toBe("attended-only");
		expect(plan.refusals[0]!.channel).toBe("termux");
	});

	it("ATTENDING: the same attended-only channel is the best available option", () => {
		const { adapter } = fakeAdapter({ unattended: false, id: "termux" });
		const plan = routeDelivery({
			request: request(),
			channels: [channel(adapter)],
			attending: true,
		});
		expect(plan.routes).toHaveLength(1);
		expect(plan.routes[0]!.channel).toBe("termux");
		expect(plan.refusals).toEqual([]);
	});

	it("attendance is decided per-channel, not for the whole catalog", () => {
		const termux = fakeAdapter({ unattended: false, id: "termux" }).adapter;
		const telegram = fakeAdapter({ unattended: true, id: "telegram" }).adapter;
		const notAttending = routeDelivery({
			request: request(),
			channels: [channel(termux), channel(telegram)],
			attending: false,
		});
		expect(notAttending.routes.map((r) => r.channel)).toEqual(["telegram"]);
		expect(notAttending.refusals.map((r) => r.channel)).toEqual(["termux"]);

		const attending = routeDelivery({
			request: request(),
			channels: [channel(termux), channel(telegram)],
			attending: true,
		});
		expect(attending.routes.map((r) => r.channel)).toEqual(["termux", "telegram"]);
	});

	it("attendance gates BEFORE capability: an attended-only channel is not even labelled", () => {
		const { adapter } = fakeAdapter({ unattended: false, capability: "announce", id: "toast" });
		const plan = routeDelivery({
			request: request(),
			channels: [channel(adapter)],
			attending: false,
		});
		expect(plan.refusals.map((r) => r.reason)).toEqual(["attended-only"]);
	});

	it("an attended-only adapter is never INVOKED when nobody is attending", async () => {
		const { adapter, seen } = fakeAdapter({ unattended: false, id: "termux" });
		const plan = routeDelivery({
			request: request(),
			channels: [channel(adapter)],
			attending: false,
		});
		const outcomes = await deliver({ plan, request: request(), sink: noSink, now: () => 5 });
		expect(seen).toEqual([]);
		expect(outcomes).toEqual([]);
	});
});

// ── D4 — three outcomes ───────────────────────────────────────────────────────

describe("D4 — delivered, refused by the transport, could not attempt", () => {
	it("the three are distinguishable, and only one means the operator was reached", async () => {
		const ok = fakeAdapter({
			id: "ok",
			capability: "announce",
			announceOutcome: () => delivered("ok", "announce", 1, "message 7"),
		}).adapter;
		const no = fakeAdapter({
			id: "no",
			capability: "announce",
			announceOutcome: () => refused("no", "announce", 1, "bot was blocked by the operator"),
		}).adapter;
		const dunno = fakeAdapter({
			id: "dunno",
			capability: "announce",
			announceOutcome: () => couldNotAttempt("dunno", "announce", 1, "network unreachable"),
		}).adapter;

		const channels = [channel(ok), channel(no), channel(dunno)];
		const plan = routeDelivery({ request: request(), channels, attending: true });
		const outcomes = await deliver({ plan, request: request(), sink: noSink, now: () => 9 });

		expect(outcomes.map((o) => o.status)).toEqual(["delivered", "refused", "could-not-attempt"]);
		const record = buildDeliveryRecord("p-1", 9, plan, outcomes);
		expect(record.reached).toBe(true);
		expect(record.answerable).toBe(false);
	});

	it("an adapter that THROWS yields could-not-attempt, never a silent success", async () => {
		const boom: DeliveryAdapter = {
			id: "boom",
			capability: "announce",
			unattended: true,
			announce: async () => {
				throw new Error("socket hang up");
			},
		};
		const plan = routeDelivery({ request: request(), channels: [channel(boom)], attending: true });
		const outcomes = await deliver({ plan, request: request(), sink: noSink, now: () => 9 });
		expect(outcomes[0]!.status).toBe("could-not-attempt");
		expect(outcomes[0]!.detail).toContain("socket hang up");
	});

	it("one adapter's failure never prevents another's delivery", async () => {
		const boom: DeliveryAdapter = {
			id: "boom",
			capability: "announce",
			unattended: true,
			announce: async () => {
				throw new Error("nope");
			},
		};
		const ok = fakeAdapter({ id: "ok", capability: "announce" }).adapter;
		const plan = routeDelivery({
			request: request(),
			channels: [channel(boom), channel(ok)],
			attending: true,
		});
		const outcomes = await deliver({ plan, request: request(), sink: noSink, now: () => 9 });
		expect(outcomes.map((o) => o.status)).toEqual(["could-not-attempt", "delivered"]);
	});

	it("an adapter returning nothing recognisable is could-not-attempt, not success", async () => {
		const mute: DeliveryAdapter = {
			id: "mute",
			capability: "announce",
			unattended: true,
			announce: async () => undefined as unknown as DeliveryOutcome,
		};
		const plan = routeDelivery({ request: request(), channels: [channel(mute)], attending: true });
		const outcomes = await deliver({ plan, request: request(), sink: noSink, now: () => 9 });
		expect(outcomes[0]!.status).toBe("could-not-attempt");
	});

	it("an outcome's adapter and mode come from the ROUTE, so an adapter cannot misattribute", async () => {
		const { adapter } = fakeAdapter({
			id: "real",
			capability: "announce",
			announceOutcome: () => delivered("someone-else", "answer", 1),
		});
		const plan = routeDelivery({ request: request(), channels: [channel(adapter)], attending: true });
		const outcomes = await deliver({ plan, request: request(), sink: noSink, now: () => 9 });
		expect(outcomes[0]!.adapter).toBe("real");
		expect(outcomes[0]!.mode).toBe("announce");
	});

	it("describeDeliveryRecord names all three outcomes and the undeclared case", () => {
		expect(describeDeliveryRecord(null)).toMatch(/no channel is declared/);

		const plan = routeDelivery({ request: request(), channels: [], attending: true });
		expect(describeDeliveryRecord(buildDeliveryRecord("p", 1, plan, []))).toMatch(/not delivered/);

		const record = buildDeliveryRecord("p", 1, plan, [
			delivered("a", "answer", 1),
			refused("b", "announce", 1, "blocked"),
			couldNotAttempt("c", "announce", 1, "offline"),
		]);
		const line = describeDeliveryRecord(record);
		expect(line).toContain("a: delivered, answerable");
		expect(line).toContain("b: refused by the transport");
		expect(line).toContain("c: could not attempt");
	});

	it("a record marks answerable only when an ANSWER route actually delivered", () => {
		const plan = routeDelivery({ request: request(), channels: [], attending: true });
		expect(
			buildDeliveryRecord("p", 1, plan, [refused("a", "answer", 1, "blocked")]).answerable,
		).toBe(false);
		expect(buildDeliveryRecord("p", 1, plan, [delivered("a", "answer", 1)]).answerable).toBe(true);
		expect(buildDeliveryRecord("p", 1, plan, [delivered("a", "announce", 1)]).answerable).toBe(
			false,
		);
	});

	it("a record carries the refusals, so an unused channel is still explained", () => {
		const { adapter } = fakeAdapter({ unattended: false, id: "termux" });
		const plan = routeDelivery({
			request: request(),
			channels: [channel(adapter)],
			attending: false,
		});
		const record = buildDeliveryRecord("p-1", 3, plan, []);
		expect(record.refusals[0]!.reason).toBe("attended-only");
		expect(describeDeliveryRecord(record)).toContain("attending");
	});
});

// ── The answer path ───────────────────────────────────────────────────────────

describe("the answer sink", () => {
	it("an answer-capable adapter settles the prompt through the sink", async () => {
		const settled: Array<string | boolean> = [];
		const { adapter } = fakeAdapter({ capability: "answer" });
		const plan = routeDelivery({ request: request(), channels: [channel(adapter)], attending: true });
		await deliver({
			plan,
			request: request(),
			sink: {
				answer: (v) => {
					settled.push(v);
					return true;
				},
			},
			now: () => 1,
		});
		expect(settled).toEqual([true]);
	});
});

// ── Secret hygiene ────────────────────────────────────────────────────────────

describe("scrubSecret / assertNoSecretInDetail", () => {
	it("removes every occurrence of a real secret", () => {
		const token = "123456:AAHwSuperSecretBotToken";
		const text = `POST https://api.telegram.org/bot${token}/sendMessage failed for ${token}`;
		const scrubbed = scrubSecret(text, token);
		expect(scrubbed).not.toContain(token);
		expect(scrubbed).not.toContain("AAHwSuperSecret");
		expect(scrubbed.split("[redacted]")).toHaveLength(3);
	});

	it("leaves text alone when there is no secret, or it is too short to scrub safely", () => {
		expect(scrubSecret("hello", undefined)).toBe("hello");
		expect(scrubSecret("hello", "")).toBe("hello");
		expect(scrubSecret("hello", "hel")).toBe("hello");
	});

	it("refuses to record a detail that still contains the credential", () => {
		const token = "123456:AAHwSuperSecretBotToken";
		expect(() => assertNoSecretInDetail(`failed: ${token}`, token)).toThrow(
			/refusing to record a detail containing a credential/,
		);
		expect(assertNoSecretInDetail("failed: [redacted]", token)).toBe("failed: [redacted]");
	});
});
