import { describe, expect, it } from "vitest";
import {
	normalizeCapabilities,
	normalizeManifest,
	pluginKeyFromId,
} from "./capabilities-normalize.js";

describe("pluginKeyFromId — the inferred routing key", () => {
	it("takes the last path segment, scope-stripped", () => {
		expect(pluginKeyFromId("@scope/vault")).toBe("vault");
		expect(pluginKeyFromId("@local/web")).toBe("web");
		expect(pluginKeyFromId("plain-id")).toBe("plain-id");
	});

	it("returns the compound segment verbatim (so a diverging key must be explicit)", () => {
		// @devbench/coding-agent's key is 'agent', NOT 'coding-agent' — the inference gives
		// the segment; the author overrides via verbs.key. This documents WHY override exists.
		expect(pluginKeyFromId("@devbench/coding-agent")).toBe("coding-agent");
	});

	it("empty / non-string id yields empty", () => {
		expect(pluginKeyFromId("")).toBe("");
		expect(pluginKeyFromId(undefined)).toBe("");
	});
});

describe("normalizeCapabilities — the verbs block lowers to raw vocab", () => {
	it("expands short verbs under the inferred key into provides (+ implicit dispatch)", () => {
		const caps = normalizeCapabilities(
			{ verbs: { list: { search: {}, extract: {} } } },
			"@scope/vault",
		);
		// Verbs are lowered in SORTED order (deterministic, host-parity), then dispatch.
		expect(caps.provides).toEqual(["vault:extract", "vault:search", "vault:dispatch"]);
		expect(caps.verbs).toBeUndefined(); // the block is lowered away
	});

	it("a non-empty verbs block ALWAYS derives <key>:dispatch (dispatch is implicit)", () => {
		// No flag — declaring verbs IS declaring a dispatchable surface.
		const caps = normalizeCapabilities({ verbs: { list: { search: {} } } }, "@scope/vault");
		expect(caps.provides).toEqual(["vault:search", "vault:dispatch"]);
		expect(caps.subscribes).toEqual(["vault:dispatch"]);
	});

	it("an explicit key overrides the id inference (diverging key)", () => {
		const caps = normalizeCapabilities(
			{ verbs: { key: "agent", list: { code: {}, review: {} } } },
			"@devbench/coding-agent",
		);
		expect(caps.provides).toEqual(["agent:code", "agent:review", "agent:dispatch"]);
		expect(caps.subscribes).toEqual(["agent:dispatch"]);
	});

	it("lowers per-verb doc + schema to verbDocs / verbSchemas keyed by the qualified verb", () => {
		const caps = normalizeCapabilities(
			{
				verbs: {
					list: {
						search: {
							doc: "Search the vault.",
							schema: { type: "object", properties: { query: { type: "string" } } },
						},
						extract: {},
					},
				},
			},
			"@scope/vault",
		);
		expect(caps.verbDocs).toEqual({ "vault:search": "Search the vault." });
		expect(caps.verbSchemas).toEqual({
			"vault:search": { type: "object", properties: { query: { type: "string" } } },
		});
	});

	it("COEXISTS with raw provides/subscribes — non-verb entries survive the merge", () => {
		// The agent case: verbs for the dispatchable surface + a raw user:prompt event.
		const caps = normalizeCapabilities(
			{
				subscribes: ["user:prompt"],
				providesApi: ["AgentRespond"],
				verbs: { key: "vault", list: { search: {} } },
			},
			"@example/agent",
		);
		expect(caps.provides).toContain("vault:search");
		expect(caps.provides).toContain("vault:dispatch");
		// The raw non-verb subscription survives, alongside the derived channel.
		expect(caps.subscribes).toEqual(["user:prompt", "vault:dispatch"]);
		// A field the block does not touch is passed through untouched.
		expect(caps.providesApi).toEqual(["AgentRespond"]);
	});

	it("provides:false makes a verb subscribe-only (opt out of the default provide)", () => {
		const caps = normalizeCapabilities(
			{
				verbs: {
					key: "vault",
					list: { search: {}, incoming: { provides: false, subscribes: true } },
				},
			},
			"@scope/vault",
		);
		// incoming NOT provided; search provided; the implicit dispatch channel added.
		expect(caps.provides).toEqual(["vault:search", "vault:dispatch"]);
		// incoming subscribed + the derived dispatch channel.
		expect(caps.subscribes).toEqual(["vault:incoming", "vault:dispatch"]);
	});

	it("de-dupes when a raw entry and an expanded entry name the same string", () => {
		const caps = normalizeCapabilities(
			{
				provides: ["vault:search"], // already declared raw...
				verbs: { key: "vault", list: { search: {} } }, // ...and via the block
			},
			"@scope/vault",
		);
		// search appears once; the implicit dispatch channel is added.
		expect(caps.provides).toEqual(["vault:search", "vault:dispatch"]);
	});

	it("no verbs block → capabilities returned unchanged (raw-only path)", () => {
		const raw = { provides: ["vault:search"], subscribes: ["vault:dispatch"] };
		expect(normalizeCapabilities(raw, "@scope/vault")).toBe(raw);
	});
});

describe("normalizeManifest — manifest-level convenience", () => {
	it("infers the key from the manifest's own id", () => {
		const m = normalizeManifest({
			id: "@scope/vault",
			capabilities: { verbs: { list: { search: {} } } },
		});
		expect(m.capabilities.provides).toEqual(["vault:search", "vault:dispatch"]);
		expect(m.capabilities.subscribes).toEqual(["vault:dispatch"]);
	});

	it("returns the manifest unchanged when there is no verbs block", () => {
		const m = { id: "@scope/vault", capabilities: { provides: ["vault:search"] } };
		expect(normalizeManifest(m)).toBe(m);
	});
});
