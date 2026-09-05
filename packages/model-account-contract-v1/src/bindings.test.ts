import { describe, expect, it } from "vitest";

import { bindingsFromConfig } from "./bindings.js";

describe("bindingsFromConfig", () => {
	it("reads the one-seat shape every node has today", () => {
		expect(bindingsFromConfig({ rcdc5: "model-account:A" })).toEqual([
			{ workspaceId: "rcdc5", credentialId: "model-account:A" },
		]);
	});

	it("reads an ordered list and preserves the order exactly", () => {
		// The order is the operator's instruction about cost. Anything that sorts, dedupes by
		// provider, or stabilises it has replaced his ranking with its own.
		expect(bindingsFromConfig({ rcdc5: ["model-account:B", "model-account:A"] })).toEqual([
			{ workspaceId: "rcdc5", credentialId: "model-account:B" },
			{ workspaceId: "rcdc5", credentialId: "model-account:A" },
		]);
	});

	it("keeps workspaces separate when both declare lists", () => {
		const parsed = bindingsFromConfig({
			rcdc5: ["model-account:A", "model-account:B"],
			refarm: "model-account:C",
		});
		expect(parsed.filter((b) => b.workspaceId === "rcdc5")).toHaveLength(2);
		expect(parsed.filter((b) => b.workspaceId === "refarm")).toHaveLength(1);
	});

	it("drops what it cannot read rather than inventing a binding", () => {
		// A malformed entry must not become a binding: the resolver treats a binding as an
		// instruction about which account pays, and a fabricated one spends money on a guess.
		expect(
			bindingsFromConfig({
				ok: "model-account:A",
				empty: "",
				blank: ["  ", "model-account:B"],
				wrong: 42 as unknown as string,
				nested: [["model-account:C"]] as unknown as string[],
			}),
		).toEqual([
			{ workspaceId: "ok", credentialId: "model-account:A" },
			{ workspaceId: "blank", credentialId: "model-account:B" },
		]);
	});

	it("reads nothing from nothing", () => {
		expect(bindingsFromConfig(undefined)).toEqual([]);
		expect(bindingsFromConfig(null)).toEqual([]);
		expect(bindingsFromConfig([] as unknown as Record<string, string>)).toEqual([]);
	});

	it("does not collapse a repeated id — the operator wrote it twice and that is his list", () => {
		// Deduping would be a silent edit of a declaration. If it is wrong, the surface that WRITES
		// the list is where it should be refused, with the operator watching.
		expect(bindingsFromConfig({ w: ["model-account:A", "model-account:A"] })).toHaveLength(2);
	});
});
