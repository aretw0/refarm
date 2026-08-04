import { isCapabilityGroup } from "@refarm.dev/capabilities";
import {
	computeRecordContentHash,
	RECORDS_CONTEXT_IRI,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import {
	createRecordsCapabilityGroup,
	defaultRecordsDeps,
	defineRecordsViewCapability,
	type RecordsCommandDeps,
} from "./records-capability.js";

/** A caller-supplied manifest — the base ships none. The records carry an
 * `externalKey` the reference enrichment fixture (`REQ-1`/`REQ-2`) matches on, so
 * enrichment produces changes. The KEY is the caller's data, not upstream vocabulary. */
function injectedManifest(): RecordsManifest {
	const records = [
		{
			id: "record:one",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord"],
			"@context": RECORDS_CONTEXT_IRI,
			fields: { title: "One", externalKey: "REQ-1" },
			review: { state: "draft", at: "2026-06-30T00:00:00.000Z" },
			contentHash: "",
		},
		{
			id: "record:two",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord"],
			"@context": RECORDS_CONTEXT_IRI,
			fields: { title: "Two", externalKey: "REQ-2" },
			review: { state: "reviewed", at: "2026-06-30T00:00:00.000Z" },
			contentHash: "",
		},
	].map((record) => ({ ...record, contentHash: computeRecordContentHash(record) }));
	return { manifestVersion: 1, records } as unknown as RecordsManifest;
}

/** A group over an INJECTED manifest — the way a work app wires it. The base ships no
 * records, so the mechanism is exercised over a caller-supplied manifest. */
function seededGroup(overrides: Partial<RecordsCommandDeps> = {}) {
	const deps: RecordsCommandDeps = {
		...defaultRecordsDeps(),
		loadManifest: injectedManifest,
		...overrides,
	};
	const g = createRecordsCapabilityGroup(deps);
	if (!isCapabilityGroup(g)) throw new Error("expected a group");
	return g;
}

/** The bare group with neutral default deps — no manifest injected. */
function defaultGroup() {
	const g = createRecordsCapabilityGroup();
	if (!isCapabilityGroup(g)) throw new Error("expected a group");
	return g;
}

async function run(
	name: string,
	options: Record<string, unknown> = {},
	makeGroup = seededGroup,
): Promise<unknown> {
	const action = makeGroup().actions[name];
	if (!action) throw new Error(`no action ${name}`);
	return action.run({ args: {}, options: options as never, json: true });
}

describe("records operator verbs (generic records:v1)", () => {
	it("declares an agent-tool + http surface (declare-once projection)", () => {
		const g = seededGroup();
		expect(g.transports?.agent).toEqual({ tool: true, toolName: "records_enrich" });
		expect(g.transports?.http).toEqual({ method: "POST", path: "/records" });
		expect(g.defaultAction).toBe("list"); // read-only default
	});

	it("the neutral default carries NO records — the base ships no domain manifest", async () => {
		const action = defaultGroup().actions.list;
		if (!action) throw new Error("no list action");
		const envelope = (await action.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			count: number;
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.count).toBe(0);
	});

	it("lists the injected manifest's records with their review states", async () => {
		const envelope = (await run("list")) as {
			ok: boolean;
			count: number;
			records: Array<{ id: string; reviewState: string }>;
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.count).toBeGreaterThan(0);
		expect(envelope.records[0]?.id).toBeTruthy();
		expect(envelope.records[0]?.reviewState).toBeTruthy();
	});

	it("enrich (dry-run) computes changes + re-validates, without claiming apply", async () => {
		const envelope = (await run("enrich")) as {
			ok: boolean;
			mode: string;
			selected: number;
			changedRecordIds: string[];
			validation: { ok: boolean };
			provider: { providerId: string };
		};
		expect(envelope.ok).toBe(true);
		expect(envelope.mode).toBe("dry-run"); // default is dry-run — no writes
		expect(envelope.selected).toBeGreaterThan(0);
		// The reference enrichment changes at least one record in the injected fixture.
		expect(envelope.changedRecordIds.length).toBeGreaterThan(0);
		// The enriched manifest still validates against records:v1 — enrichment is
		// consumer-owned but must not break the schema.
		expect(envelope.validation.ok).toBe(true);
		expect(envelope.provider.providerId).toBeTruthy();
	});

	it("enrich emits a real EnrichmentTelemetryEvent for the provider.enrich() call", async () => {
		const envelope = (await run("enrich")) as {
			telemetry: {
				traceId: string;
				pluginId: string;
				capability: string;
				operation: string;
				durationMs: number;
				ok: boolean;
				errorCode?: string;
			};
		};
		const { telemetry } = envelope;
		// A real, per-invocation id — not a stub. Two calls must not collide.
		expect(telemetry.traceId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
		const other = (await run("enrich")) as typeof envelope;
		expect(other.telemetry.traceId).not.toBe(telemetry.traceId);
		// The event's OWN fields, straight from the injected provider — not hardcoded.
		expect(telemetry.pluginId).toBe(defaultRecordsDeps().enrichmentProvider.pluginId);
		expect(telemetry.capability).toBe("enrichment:v1");
		expect(telemetry.operation).toBe("enrich");
		expect(telemetry.ok).toBe(true);
		expect(telemetry.errorCode).toBeUndefined();
		expect(telemetry.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("enrich --apply reports apply mode (the operator's explicit call)", async () => {
		const envelope = (await run("enrich", { apply: true })) as { mode: string };
		expect(envelope.mode).toBe("apply");
	});

	it("the enrichment is deterministic (same changes across runs)", async () => {
		const a = (await run("enrich")) as { changedRecordIds: string[] };
		const b = (await run("enrich")) as { changedRecordIds: string[] };
		expect(a.changedRecordIds).toEqual(b.changedRecordIds);
	});
});

describe("records correct — the analyst applies a review (persistence is INJECTED)", () => {
	// The first injected record's id (from injectedManifest above).
	const RECORD_ID = "record:one";

	async function correct(
		args: { id: string; state: string },
		options: Record<string, unknown> = {},
		overrides: Partial<RecordsCommandDeps> = {},
	): Promise<Record<string, unknown>> {
		const action = seededGroup(overrides).actions.correct;
		if (!action) throw new Error("no correct action");
		return (await action.run({
			args,
			options: options as never,
			json: true,
		})) as unknown as Record<string, unknown>;
	}

	it("dry-run reports the review without persisting (no sink injected)", async () => {
		const env = await correct({ id: RECORD_ID, state: "reviewed" }, { notes: "ok" });
		expect(env.ok).toBe(true);
		expect(env.mode).toBe("dry-run");
		expect(env.persisted).toBe(false);
		expect(env.writable).toBe(false); // the base ships no save sink
		expect((env.review as { state: string; notes?: string }).state).toBe("reviewed");
		expect((env.review as { notes?: string }).notes).toBe("ok");
		expect((env.validation as { ok: boolean }).ok).toBe(true);
	});

	it("--apply persists the corrected manifest via the INJECTED save sink", async () => {
		const saved: unknown[] = [];
		const env = await correct(
			{ id: RECORD_ID, state: "reviewed" },
			{ apply: true, by: "analyst" },
			{ saveManifest: (m) => void saved.push(m) },
		);
		expect(env.ok).toBe(true);
		expect(env.mode).toBe("apply");
		expect(env.persisted).toBe(true);
		expect(env.writable).toBe(true);
		// The saved manifest carries the corrected record's new review state.
		expect(saved).toHaveLength(1);
		const savedManifest = saved[0] as {
			records: Array<{ id: string; review?: { state: string; by?: string } }>;
		};
		const rec = savedManifest.records.find((r) => r.id === RECORD_ID);
		expect(rec?.review?.state).toBe("reviewed");
		expect(rec?.review?.by).toBe("analyst");
	});

	it("--apply without an injected sink stays dry (writable=false, not persisted)", async () => {
		const env = await correct({ id: RECORD_ID, state: "reviewed" }, { apply: true });
		expect(env.ok).toBe(true);
		expect(env.persisted).toBe(false);
		expect(env.writable).toBe(false);
	});

	it("an unknown record id returns an error envelope", async () => {
		const env = await correct({ id: "record:nope", state: "reviewed" });
		expect(env.ok).toBe(false);
		expect(env.error).toBe("record_not_found");
	});
});

describe("records analyze — a neutral grouping+count envelope (persona-agnostic)", () => {
	async function analyze(options: Record<string, unknown> = {}) {
		const action = seededGroup().actions.analyze;
		if (!action) throw new Error("no analyze action");
		return (await action.run({ args: {}, options: options as never, json: true })) as unknown as {
			ok: boolean;
			by: string;
			summary: { total: number; byState: Record<string, number> };
			groups: Array<{ key: string; count: number; records: Array<{ id: string; link: string }> }>;
		};
	}

	it("groups by reviewState (the default) with per-state counts", async () => {
		const env = await analyze();
		expect(env.ok).toBe(true);
		expect(env.by).toBe("reviewState");
		// The injected manifest has one draft + one reviewed record.
		expect(env.summary.total).toBe(2);
		expect(env.summary.byState.draft).toBe(1);
		expect(env.summary.byState.reviewed).toBe(1);
		const states = env.groups.map((g) => g.key).sort();
		expect(states).toEqual(["draft", "reviewed"]);
		// Each grouped record carries a vault-relative link a renderer/MOC can point to.
		expect(env.groups[0]?.records[0]?.link.endsWith(".md")).toBe(true);
	});

	it("groups by type when asked (a different lens over the SAME records)", async () => {
		const env = await analyze({ by: "type" });
		expect(env.by).toBe("type");
		// The injected records are @type ["KnowledgeRecord"] → one group of 2.
		const known = env.groups.find((g) => g.key === "KnowledgeRecord");
		expect(known?.count).toBe(2);
	});

	it("groups by sourceRef — the envelope is data, not a rendered view", async () => {
		const env = await analyze({ by: "sourceRef" });
		expect(env.by).toBe("sourceRef");
		// It's a plain object a TUI/web/Astro/vault renderer each reads its own way.
		expect(Array.isArray(env.groups)).toBe(true);
		expect(typeof env.summary.total).toBe("number");
	});

	it("groups by an arbitrary field (field:<name>) — the generic domain-dimension lens", async () => {
		// The injected records carry distinct externalKey values → one group each. This is
		// how a rich MOC groups by a DOMAIN field (e.g. a requirement's `tipo`) without the
		// dimension union hardcoding domain vocabulary.
		const env = await analyze({ by: "field:externalKey" });
		expect(env.by).toBe("field:externalKey");
		const keys = env.groups.map((g) => g.key).sort();
		expect(keys).toEqual(["REQ-1", "REQ-2"]);
		expect(env.groups.find((g) => g.key === "REQ-1")?.count).toBe(1);
	});

	it("puts records missing the field under 'unspecified'", async () => {
		const env = await analyze({ by: "field:tipo" });
		// Neither injected record has a `tipo` field → all under one 'unspecified' group.
		expect(env.groups.map((g) => g.key)).toEqual(["unspecified"]);
		expect(env.groups[0]?.count).toBe(2);
	});

	it("falls back to reviewState for a malformed dimension (empty field name)", async () => {
		const env = await analyze({ by: "field:" });
		expect(env.by).toBe("reviewState");
	});

	it("carries a record's tipped relations in the group entry (the graph for a MOC)", async () => {
		const withRelations = (): RecordsManifest => {
			const records = [
				{
					id: "record:a",
					schemaVersion: 1,
					"@type": ["KnowledgeRecord"],
					"@context": RECORDS_CONTEXT_IRI,
					fields: { title: "A" },
					relations: [{ type: "references", target: "record:b", attrs: { direction: "outgoing" } }],
					review: { state: "draft", at: "2026-06-30T00:00:00.000Z" },
					contentHash: "",
				},
				{
					id: "record:b",
					schemaVersion: 1,
					"@type": ["KnowledgeRecord"],
					"@context": RECORDS_CONTEXT_IRI,
					fields: { title: "B" },
					review: { state: "draft", at: "2026-06-30T00:00:00.000Z" },
					contentHash: "",
				},
			].map((r) => ({ ...r, contentHash: computeRecordContentHash(r) }));
			return { manifestVersion: 1, records } as unknown as RecordsManifest;
		};
		const g = seededGroup({ loadManifest: withRelations });
		const env = (await g.actions.analyze!.run({
			args: {},
			options: {} as never,
			json: true,
		})) as unknown as { groups: Array<{ records: Array<{ id: string; relations?: unknown[] }> }> };
		const a = env.groups.flatMap((grp) => grp.records).find((r) => r.id === "record:a");
		const b = env.groups.flatMap((grp) => grp.records).find((r) => r.id === "record:b");
		expect(a?.relations).toEqual([
			{ type: "references", target: "record:b", attrs: { direction: "outgoing" } },
		]);
		// A record with no relations omits the field.
		expect(b?.relations).toBeUndefined();
	});
});

describe("defineRecordsViewCapability — persona views over records analyze", () => {
	it("declares a product view without rewiring the analyze action", async () => {
		const view = defineRecordsViewCapability({
			name: "wallet",
			summary: "Show my wallet",
			records: {
				...defaultRecordsDeps(),
				loadManifest: injectedManifest,
			},
			project: (analysis) => ({
				total: analysis.summary.total,
				headline: `${analysis.summary.total} records across ${analysis.groups.length} groups`,
				groupKeys: analysis.groups.map((group) => group.key),
			}),
		});

		expect(view.transports?.http).toEqual({ method: "GET", path: "/wallet" });
		expect(view.renderers?.tui).toEqual({ section: "wallet" });

		const env = (await view.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			command: string;
			operation: string;
			total: number;
			headline: string;
			groupKeys: string[];
		};

		expect(env.ok).toBe(true);
		expect(env.command).toBe("wallet");
		expect(env.operation).toBe("render");
		expect(env.total).toBe(2);
		expect(env.headline).toBe("2 records across 2 groups");
		expect(env.groupKeys).toEqual(["draft", "reviewed"]);
	});

	it("lets the product view expose the neutral analyze dimension as a surface option", async () => {
		const view = defineRecordsViewCapability({
			name: "requirements",
			summary: "Show requirements",
			records: {
				...defaultRecordsDeps(),
				loadManifest: injectedManifest,
			},
			httpPath: "/requirements/moc",
			options: [
				{ name: "by", kind: "string", summary: "Group by reviewState, type, or sourceRef" },
			],
			project: (analysis) => ({
				by: analysis.by,
				groupKeys: analysis.groups.map((group) => group.key),
			}),
		});

		expect(view.transports?.http).toEqual({ method: "GET", path: "/requirements/moc" });

		const env = (await view.run({
			args: {},
			options: { by: "type" },
			json: true,
		})) as unknown as {
			ok: boolean;
			by: string;
			groupKeys: string[];
		};

		expect(env.ok).toBe(true);
		expect(env.by).toBe("type");
		expect(env.groupKeys).toEqual(["KnowledgeRecord"]);
	});
});
