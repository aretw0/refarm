import { describe, expect, it } from "vitest";
import { createInMemorySessionAdapter } from "./in-memory.js";

describe("createInMemorySessionAdapter", () => {
	it("supports participant query and chronological limited entries", async () => {
		const adapter = createInMemorySessionAdapter();
		const session = await adapter.create({
			"@type": "Session",
			participants: ["urn:user:1", "urn:agent:1"],
			context_id: "urn:ctx:1",
		});

		const first = await adapter.appendEntry({
			"@type": "SessionEntry",
			session_id: session["@id"],
			parent_entry_id: null,
			kind: "user",
			content: "hello",
		});
		await adapter.appendEntry({
			"@type": "SessionEntry",
			session_id: session["@id"],
			parent_entry_id: first["@id"],
			kind: "agent",
			content: "hi",
		});

		const filtered = await adapter.query?.({ participants: ["urn:user:1"] });
		expect(filtered).toHaveLength(1);
		expect(filtered?.[0]["@id"]).toBe(session["@id"]);

		const latest = await adapter.entries?.(session["@id"], 1);
		expect(latest).toHaveLength(1);
		expect(latest?.[0].parent_entry_id).toBe(first["@id"]);
	});
});
