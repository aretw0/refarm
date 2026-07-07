import { isCapabilityGroup } from "@refarm.dev/cli/capabilities";
import {
	computeRecordContentHash,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";
import { describe, expect, it } from "vitest";

import {
	createRecordsCapabilityGroup,
	defaultRecordsDeps,
	type RecordsCommandDeps,
} from "./records-capability.js";

/** A caller-supplied manifest — refarm ships none. The records carry an
 * `externalKey` the reference enrichment fixture (`REQ-1`/`REQ-2`) matches on, so
 * enrichment produces changes. The KEY is the caller's data, not refarm vocabulary. */
function injectedManifest(): RecordsManifest {
	const records = [
		{
			id: "record:one",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: { title: "One", externalKey: "REQ-1" },
			review: { state: "draft", at: "2026-06-30T00:00:00.000Z" },
			contentHash: "",
		},
		{
			id: "record:two",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: { title: "Two", externalKey: "REQ-2" },
			review: { state: "reviewed", at: "2026-06-30T00:00:00.000Z" },
			contentHash: "",
		},
	].map((record) => ({ ...record, contentHash: computeRecordContentHash(record) }));
	return { manifestVersion: 1, records } as unknown as RecordsManifest;
}

/** A group over an INJECTED manifest — the way a work app wires it. refarm ships no
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

/** The bare group with refarm's NEUTRAL default deps — no manifest injected. */
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

	it("the neutral default carries NO records — refarm ships no domain manifest", async () => {
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
