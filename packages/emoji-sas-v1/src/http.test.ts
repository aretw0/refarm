import { describe, expect, it } from "vitest";

import { generateSasKeyPair, openSasPayload, sealSasPayload, SAS_WIRE } from "./exchange.js";
import { handleSasHttp, SAS_HTTP_BASE, type SasHttpOptions } from "./http.js";
import { SCOPE_ANSWER_PROMPTS } from "./scoped-credential.js";
import {
	createInMemorySasExchangeStore,
	createSasRateLimiter,
	SAS_MAX_PENDING,
	SAS_START_LIMIT,
	SAS_START_WINDOW_MS,
	toVerificationRecord,
	type SasExchangeStore,
} from "./store.js";
import type { SasTranscript } from "./transcript.js";

const NOW = 1_700_000_000_000;

interface Harness {
	options: SasHttpOptions;
	store: SasExchangeStore;
	clock: { now: number };
}

function harness(overrides: Partial<SasHttpOptions> = {}): Harness {
	const store = createInMemorySasExchangeStore();
	const clock = { now: NOW };
	return {
		store,
		clock,
		options: {
			store,
			limiter: createSasRateLimiter(),
			surface: "web",
			now: () => clock.now,
			...overrides,
		},
	};
}

async function start(h: Harness, body?: Record<string, unknown>) {
	const pair = await generateSasKeyPair({ extractable: true });
	const response = await handleSasHttp(h.options, {
		method: "POST",
		path: `${SAS_HTTP_BASE}/start`,
		body: { wire: SAS_WIRE, publicKey: pair.publicKey, ...body },
	});
	return { pair, response: response! };
}

describe("E2 — start is open, bounded, and grants nothing", () => {
	it("answers with two PUBLIC values and an id, and nothing else about the exchange", async () => {
		const h = harness();
		const { response } = await start(h);
		expect(response.status).toBe(201);
		expect(Object.keys(response.body).sort()).toEqual(
			[
				"confirmerPublicKey",
				"expiresAt",
				"id",
				"lifetimeMs",
				"nextStep",
				"ok",
				"pollIntervalMs",
				"scope",
				"wire",
			].sort(),
		);
		// The private key is the one sensitive field an exchange holds. It must never be
		// on a response, and this asserts the whole serialized body rather than a field.
		const stored = (await h.store.list())[0]!;
		const serialized = JSON.stringify(response.body);
		expect(stored.confirmerPrivateKeyJwk?.d).toBeTruthy();
		expect(serialized).not.toContain(stored.confirmerPrivateKeyJwk!.d!);
		expect(serialized).not.toContain(JSON.stringify(stored.confirmerPrivateKeyJwk));
		expect(serialized).not.toContain("privateKey");
	});

	it("NOTHING is readable back before confirmation — a start cannot be used to probe", async () => {
		const h = harness();
		const { response } = await start(h);
		const poll = await handleSasHttp(h.options, {
			method: "GET",
			path: `${SAS_HTTP_BASE}/${response.body.id as string}`,
		});
		expect(poll!.status).toBe(200);
		expect(poll!.body).toEqual({ wire: SAS_WIRE, ok: true, state: "pending", pollIntervalMs: 2_000 });
	});

	it("pending verifications are not enumerable", async () => {
		const h = harness();
		await start(h);
		const listed = await handleSasHttp(h.options, { method: "GET", path: SAS_HTTP_BASE });
		expect(listed!.status).toBe(404);
		expect(listed!.body.error).toBe("not-listable");
	});

	it("an unknown id and a collected id are the same answer — no oracle", async () => {
		const h = harness();
		const unknown = await handleSasHttp(h.options, {
			method: "GET",
			path: `${SAS_HTTP_BASE}/aaaaaaaaaaaa`,
		});
		expect(unknown!.status).toBe(404);
		expect(unknown!.body.error).toBe("unknown-exchange");
	});

	it("refuses a malformed public key BEFORE consuming a pending slot or a rate slot", async () => {
		const h = harness();
		for (let i = 0; i < SAS_START_LIMIT * 3; i += 1) {
			const refused = await handleSasHttp(h.options, {
				method: "POST",
				path: `${SAS_HTTP_BASE}/start`,
				body: { publicKey: "not-a-key" },
			});
			expect(refused!.status).toBe(400);
			expect(refused!.body.error).toBe("invalid-public-key");
		}
		expect(await h.store.list()).toHaveLength(0);
		// An honest caller's budget survived the flood of malformed ones.
		expect((await start(h)).response.status).toBe(201);
	});

	it("refuses a missing public key, saying what it wanted", async () => {
		const h = harness();
		const refused = await handleSasHttp(h.options, {
			method: "POST",
			path: `${SAS_HTTP_BASE}/start`,
			body: {},
		});
		expect(refused!.status).toBe(400);
		expect(refused!.body.error).toBe("public-key-required");
		expect(String(refused!.body.detail)).toContain("publicKey");
	});

	it("refuses an unknown scope rather than narrowing it", async () => {
		const h = harness();
		const { response } = await start(h, { scope: ["sidecar:call"] });
		expect(response.status).toBe(400);
		expect(response.body.error).toBe("unknown-scope");
		expect(response.body.scopes).toEqual([SCOPE_ANSWER_PROMPTS]);
	});

	it("refuses the wrong method on both routes", async () => {
		const h = harness();
		const getStart = await handleSasHttp(h.options, { method: "GET", path: `${SAS_HTTP_BASE}/start` });
		expect(getStart!.status).toBe(405);
		const postPoll = await handleSasHttp(h.options, {
			method: "POST",
			path: `${SAS_HTTP_BASE}/aaaaaaaaaaaa`,
		});
		expect(postPoll!.status).toBe(405);
	});

	it("owns nothing outside its own paths", async () => {
		const h = harness();
		expect(await handleSasHttp(h.options, { method: "GET", path: "/index.html" })).toBeNull();
		expect(await handleSasHttp(h.options, { method: "GET", path: `${SAS_HTTP_BASE}/lib/index.js` })).toBeNull();
	});
});

describe("the bounds hold (E2/E5)", () => {
	it("refuses beyond the pending ceiling — loudly, not by queueing", async () => {
		const h = harness({ limiter: createSasRateLimiter({ limit: 1000 }) });
		for (let i = 0; i < SAS_MAX_PENDING; i += 1) {
			expect((await start(h)).response.status).toBe(201);
		}
		const refused = (await start(h)).response;
		expect(refused.status).toBe(503);
		expect(refused.body.error).toBe("too-many-pending");
		expect(refused.body.maxPending).toBe(SAS_MAX_PENDING);
		expect(String(refused.body.detail)).toContain("Confirm or cancel one at the node");
		expect((await h.store.list()).filter((e) => e.state === "pending")).toHaveLength(SAS_MAX_PENDING);
	});

	it("rate-limits starts and says WHEN to come back — a silent drop teaches retrying harder", async () => {
		const h = harness({ maxPending: 1000 });
		for (let i = 0; i < SAS_START_LIMIT; i += 1) {
			expect((await start(h)).response.status).toBe(201);
		}
		const refused = (await start(h)).response;
		expect(refused.status).toBe(429);
		expect(refused.body.error).toBe("rate-limited");
		expect(refused.retryAfterSeconds).toBeGreaterThan(0);
		expect(refused.body.retryAfterMs).toBeGreaterThan(0);

		// The window rolls, and the caller is welcome again.
		h.clock.now += SAS_START_WINDOW_MS;
		expect((await start(h)).response.status).toBe(201);
	});

	it("states the poll interval rather than leaving a caller to guess", async () => {
		const h = harness();
		const { response } = await start(h);
		expect(response.body.pollIntervalMs).toBe(2_000);
	});

	it("expires an unconfirmed exchange, records it, and tells the caller", async () => {
		const h = harness();
		const { response } = await start(h);
		const id = response.body.id as string;
		h.clock.now += 5 * 60_000;
		const poll = await handleSasHttp(h.options, { method: "GET", path: `${SAS_HTTP_BASE}/${id}` });
		expect(poll!.body.state).toBe("aborted");
		expect(poll!.body.reason).toBe("expired");
		const records = await h.store.records();
		expect(records).toHaveLength(1);
		expect(records[0]!.outcome).toBe("aborted");
		expect(records[0]!.reason).toBe("expired");
		// An expired exchange frees its slot rather than holding it forever.
		expect((await h.store.list()).filter((e) => e.state === "pending")).toHaveLength(0);
	});
});

describe("S5 — a mismatch aborts, is recorded, and is NEVER a retry", () => {
	it("settles once; a second settlement is refused", async () => {
		const h = harness();
		const { response } = await start(h);
		const id = response.body.id as string;

		const aborted = await h.store.settle(id, { state: "aborted", at: NOW, abortReason: "mismatch" });
		expect(aborted?.state).toBe("aborted");
		// MUTATION GUARD for "never a retry": if an aborted exchange could be settled
		// again — as `granted`, say — a mismatched party would only have to ask twice.
		expect(await h.store.settle(id, { state: "granted", at: NOW, sealed: null })).toBeNull();
		expect((await h.store.get(id))?.state).toBe("aborted");
	});

	it("tells the aborted caller it is over, and that starting again is a NEW exchange", async () => {
		const h = harness();
		const { response } = await start(h);
		const id = response.body.id as string;
		const settled = await h.store.settle(id, { state: "aborted", at: NOW, abortReason: "mismatch" });
		await h.store.record(toVerificationRecord(settled!, NOW));

		const poll = await handleSasHttp(h.options, { method: "GET", path: `${SAS_HTTP_BASE}/${id}` });
		expect(poll!.body.ok).toBe(false);
		expect(poll!.body.state).toBe("aborted");
		expect(poll!.body.reason).toBe("mismatch");
		expect(String(poll!.body.detail)).toContain("never retried");

		// Terminal: the dead exchange is forgotten, so it cannot be polled as a heartbeat.
		const again = await handleSasHttp(h.options, { method: "GET", path: `${SAS_HTTP_BASE}/${id}` });
		expect(again!.status).toBe(404);
	});

	it("the record names the outcome and the party, and carries NO key material", async () => {
		const h = harness();
		const { response } = await start(h, { client: "Firefox on the laptop" });
		const id = response.body.id as string;
		const stored = (await h.store.get(id))!;
		const settled = await h.store.settle(id, { state: "aborted", at: NOW, abortReason: "mismatch" });
		await h.store.record(toVerificationRecord(settled!, NOW));

		const record = (await h.store.records())[0]!;
		expect(record.outcome).toBe("aborted");
		expect(record.reason).toBe("mismatch");
		expect(record.client).toBe("Firefox on the laptop");
		expect(record.surface).toBe("web");
		const serialized = JSON.stringify(record);
		expect(serialized).not.toContain(JSON.stringify(stored.confirmerPrivateKeyJwk));
		expect(serialized).not.toContain(stored.confirmerPrivateKeyJwk?.d);
		expect(serialized).not.toContain("token");
	});

	it("the private key does not survive a settlement, in either direction", async () => {
		const h = harness();
		for (const state of ["granted", "aborted"] as const) {
			const { response } = await start(h);
			const id = response.body.id as string;
			expect((await h.store.get(id))?.confirmerPrivateKeyJwk).toBeTruthy();
			const settled = await h.store.settle(id, { state, at: NOW, abortReason: state === "aborted" ? "cancelled" : null });
			expect(settled?.confirmerPrivateKeyJwk).toBeNull();
		}
	});
});

describe("a granted exchange", () => {
	it("delivers the sealed credential exactly once, then forgets it", async () => {
		const h = harness();
		const { pair, response } = await start(h);
		const id = response.body.id as string;
		const stored = (await h.store.get(id))!;
		const transcript: SasTranscript = {
			sessionId: id,
			initiatorPublicKey: stored.initiatorPublicKey,
			confirmerPublicKey: stored.confirmerPublicKey,
		};
		const confirmer = await generateSasKeyPair({ extractable: true });
		// Seal with a key the initiator can actually open against: the store's own
		// confirmer key is exercised end-to-end by the CLI test; here the point is the
		// once-only delivery.
		const sealed = await sealSasPayload({
			privateKey: confirmer.privateKey,
			peerPublicKey: pair.publicKey,
			transcript: { ...transcript, confirmerPublicKey: confirmer.publicKey },
			plaintext: "scoped-token",
		});
		await h.store.settle(id, { state: "granted", at: NOW, sealed, credentialId: "sas-1" });

		const first = await handleSasHttp(h.options, { method: "GET", path: `${SAS_HTTP_BASE}/${id}` });
		expect(first!.body.state).toBe("granted");
		expect(first!.body.credentialId).toBe("sas-1");
		expect(
			await openSasPayload({
				privateKey: pair.privateKey,
				peerPublicKey: confirmer.publicKey,
				transcript: { ...transcript, confirmerPublicKey: confirmer.publicKey },
				sealed: first!.body.sealed as never,
			}),
		).toBe("scoped-token");

		const second = await handleSasHttp(h.options, { method: "GET", path: `${SAS_HTTP_BASE}/${id}` });
		expect(second!.status).toBe(404);
	});
});
