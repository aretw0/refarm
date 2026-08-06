import assert from "node:assert/strict";
import test from "node:test";
import {
	analyzeContextDependencyPressure,
	contextDependencyPressurePasses,
	renderArchitectureContextMapMarkdown,
	validateArchitectureContextMap,
} from "./lib/architecture-context-map.mjs";

const inventory = {
	workspaces: [
		{ name: "a", path: "packages/a", internalDependencies: [], internalDependencyScopes: {} },
		{ name: "b", path: "packages/b", internalDependencies: ["a"], internalDependencyScopes: { a: ["dependencies"] } },
		{ name: "seam", path: "packages/seam", internalDependencies: [] },
	],
};
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
	const pressure = analyzeContextDependencyPressure(validMap, inventory);
	assert.deepEqual(pressure.summary, {
		edges: 1,
		declaredEdges: 1,
		undeclaredEdges: 0,
		undeclaredRuntimeEdges: 0,
		devOnlyEdges: 0,
		undeclaredDevOnlyEdges: 0,
		pairs: 1,
		undeclaredPairs: 0,
		undeclaredRuntimePairs: 0,
		undeclaredDevOnlyPairs: 0,
	});
	assert.equal(contextDependencyPressurePasses(pressure), true);
	assert.match(renderArchitectureContextMapMarkdown(validMap, pressure), /Dependency pressure \(observational\)/);
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

test("reports undeclared dependency pressure without turning it into a structural violation", () => {
	const provisional = structuredClone(validMap);
	provisional.relationships = [];
	assert.deepEqual(validateArchitectureContextMap(provisional, inventory), { ok: true, violations: [] });
	const pressure = analyzeContextDependencyPressure(provisional, inventory);
	assert.equal(pressure.summary.undeclaredEdges, 1);
	assert.equal(pressure.summary.undeclaredPairs, 1);
	assert.equal(contextDependencyPressurePasses(pressure), false);
});
