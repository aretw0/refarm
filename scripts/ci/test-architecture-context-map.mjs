import assert from "node:assert/strict";
import test from "node:test";
import { renderArchitectureContextMapMarkdown, validateArchitectureContextMap } from "./lib/architecture-context-map.mjs";

const inventory = { workspaces: [{ path: "packages/a" }, { path: "packages/b" }, { path: "packages/seam" }] };
const validMap = {
	schemaVersion: 1,
	status: "provisional",
	direction: "upstream-to-downstream",
	contexts: [
		{ id: "a", name: "A", purpose: "Own A.", maturity: "established-boundary", anchors: ["packages/a"] },
		{ id: "b", name: "B", purpose: "Own B.", maturity: "candidate-boundary", anchors: ["packages/b"] },
	],
	relationships: [{ from: "a", to: "b", kind: "supplier", seams: ["packages/seam"] }],
};

test("accepts explicit anchors and seams that exist in the inventory", () => {
	assert.deepEqual(validateArchitectureContextMap(validMap, inventory), { ok: true, violations: [] });
	assert.match(renderArchitectureContextMapMarkdown(validMap), /upstream supplier to downstream consumer/);
});

test("rejects ambiguous ownership and unknown relationship seams", () => {
	const invalid = structuredClone(validMap);
	invalid.contexts[1].anchors.push("packages/a");
	invalid.relationships[0].seams = ["packages/missing"];
	const result = validateArchitectureContextMap(invalid, inventory);
	assert.equal(result.ok, false);
	assert.deepEqual(result.violations.map((violation) => violation.id), [
		"ambiguous-anchor-owner",
		"unknown-relationship-seam",
	]);
});
