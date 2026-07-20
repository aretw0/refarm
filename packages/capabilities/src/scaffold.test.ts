import { describe, expect, it } from "vitest";

import { buildCapabilityScaffold, toCamelCase } from "./scaffold.js";

describe("toCamelCase", () => {
	it("camel-cases kebab/underscore/space names", () => {
		expect(toCamelCase("search")).toBe("search");
		expect(toCamelCase("search-notes")).toBe("searchNotes");
		expect(toCamelCase("search_notes")).toBe("searchNotes");
		expect(toCamelCase("Search Notes")).toBe("searchNotes");
	});
});

describe("buildCapabilityScaffold", () => {
	const spec = {
		name: "search",
		summary: "Search things",
		args: [{ name: "query", required: true, type: "string" as const }],
		options: [{ name: "limit", kind: "integer" as const, summary: "Max results" }],
	};

	it("emits a descriptor file + a test file, keyed off the verb name", () => {
		const scaffold = buildCapabilityScaffold(spec);
		expect(scaffold.descriptor.path).toBe("search.ts");
		expect(scaffold.test.path).toBe("search.test.ts");
	});

	it("descriptor declares the verb ONCE with typed args/options, and imports the envelope from the subpath", () => {
		const { content } = buildCapabilityScaffold(spec).descriptor;
		expect(content).toContain("export const searchCapability: CapabilityDescriptor");
		expect(content).toContain('name: "search"');
		expect(content).toContain('{"name":"query","required":true,"type":"string"}');
		expect(content).toContain('{"name":"limit","kind":"integer","summary":"Max results"}');
		expect(content).toContain('transports: { http: { method: "POST", path: "/search" } }');
		// buildJsonSuccessEnvelope lives on the /envelope subpath, not the main entry.
		expect(content).toContain('from "@refarm.dev/capabilities/envelope"');
	});

	it("prefers a numeric/enum OPTION for the rejection (named on EVERY surface incl. argv dispatch)", () => {
		const scaffold = buildCapabilityScaffold(spec);
		expect(scaffold.invalidField).toBe("limit"); // the integer option, not the required arg
		const { content } = scaffold.test;
		expect(content).toContain("the shared validator rejects it, naming `limit`");
		expect(content).toContain("the CLI/TUI dispatch rejects it, naming `limit`");
		expect(content).toContain("the HTTP route rejects it with 422, naming `limit`");
		// a non-numeric string is coercion-stable (Ajv cannot coerce it; the Rust host also rejects).
		expect(content).toContain('"limit":"not-a-number"');
		// the required arg carries a valid dummy so the option is the SOLE violation on the dispatch leg.
		expect(content).toContain('badArgv: string[] = ["x","--limit","not-a-number"]');
	});

	it("uses an enum sentinel when the chosen option is an enum", () => {
		const scaffold = buildCapabilityScaffold({
			name: "sort",
			options: [{ name: "order", kind: "string", summary: "Sort order", enum: ["asc", "desc"] }],
		});
		expect(scaffold.invalidField).toBe("order");
		expect(scaffold.test.content).toContain('"order": "__invalid__"');
	});

	it("falls back to a required ARG (missing) when there is no typed option; dispatch asserts rejection only", () => {
		const scaffold = buildCapabilityScaffold({
			name: "open",
			args: [{ name: "path", required: true, type: "string" }],
		});
		expect(scaffold.invalidField).toBe("path");
		const { content } = scaffold.test;
		expect(content).toContain("the shared validator rejects the missing `path`, naming it");
		expect(content).toContain("the agent schema marks `path` required");
		expect(content).toContain("the CLI/TUI dispatch rejects the missing required input");
		expect(content).toContain("the HTTP route rejects it with 422, naming `path`");
	});

	it("emits a schema-only test when there is neither a typed option nor a required arg", () => {
		const scaffold = buildCapabilityScaffold({ name: "ping" });
		expect(scaffold.invalidField).toBeNull();
		expect(scaffold.test.content).toContain("add a required arg or a numeric/enum option");
		expect(scaffold.test.content).not.toContain("422");
	});
});
