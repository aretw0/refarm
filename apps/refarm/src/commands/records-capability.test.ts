import { isCapabilityGroup } from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { createRecordsCapabilityGroup } from "./records-capability.js";

function group() {
	const g = createRecordsCapabilityGroup();
	if (!isCapabilityGroup(g)) throw new Error("expected a group");
	return g;
}

async function run(name: string, options: Record<string, unknown> = {}): Promise<unknown> {
	const action = group().actions[name];
	if (!action) throw new Error(`no action ${name}`);
	return action.run({ args: {}, options: options as never, json: true });
}

describe("records operator verbs (T3)", () => {
	it("declares an agent-tool + http surface (declare-once projection)", () => {
		const g = group();
		expect(g.transports?.agent).toEqual({ tool: true, toolName: "records_enrich" });
		expect(g.transports?.http).toEqual({ method: "POST", path: "/records" });
		expect(g.defaultAction).toBe("list"); // read-only default
	});

	it("lists the notes-box records with their review states", async () => {
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
		// The reference enrichment changes at least one record (the CNPJ-shaped fixture).
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
