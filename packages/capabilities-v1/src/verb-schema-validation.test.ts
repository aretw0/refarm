import { validateAgainstSchema } from "@refarm.dev/capabilities";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The TS (Ajv) half of the cross-language validation invariant. The SAME fixture that proves the derived
 * verbSchema is byte-identical across TS and Rust (plugin-bridge.test + tractor's plugin_registry) now also
 * carries VALIDATION cases: for a verb's schema, a set of `{ input, valid, errorField }` outcomes. Here the
 * shared Ajv validator (validateAgainstSchema) must produce those outcomes; in Rust,
 * `validate_tool_input_matches_ts_conformance_fixture` drives the SAME cases through `jsonschema`. One
 * fixture, two languages, identical verdicts — the "declare once → validated the same on every surface"
 * claim made executable across the RS↔TS boundary (the agent-tool + plugin→plugin legs are Rust-side).
 *
 * The cases are COERCION-STABLE by construction (see the fixture's `validationNote`): this Ajv coerces
 * string form-input to the schema's types while the Rust host does not, so every shared case is one whose
 * verdict does not depend on coercion.
 */

interface ExpectedVerb {
	pluginId: string;
	verb: string;
	schema: Record<string, unknown> | null;
}
interface ValidationCase {
	input: Record<string, unknown>;
	valid: boolean;
	errorField?: string;
}
interface ValidationEntry {
	pluginId: string;
	verb: string;
	cases: ValidationCase[];
}

const fixture = JSON.parse(
	readFileSync(new URL("../fixtures/plugin-surface-verbs.json", import.meta.url), "utf-8"),
) as { expected: ExpectedVerb[]; validation: ValidationEntry[] };

/** Resolve the derived schema for a verb from the fixture's `expected` (the same bytes the Rust host uses). */
function schemaFor(pluginId: string, verb: string): Record<string, unknown> {
	const found = fixture.expected.find((e) => e.pluginId === pluginId && e.verb === verb);
	if (!found?.schema) throw new Error(`fixture has no schema for ${pluginId}:${verb}`);
	return found.schema;
}

describe("verb-schema validation conformance (TS Ajv side of the cross-language invariant)", () => {
	it("carries validation cases for at least the notes:find + vault:search verbs", () => {
		expect(fixture.validation.length).toBeGreaterThanOrEqual(2);
	});

	for (const entry of fixture.validation) {
		const schema = schemaFor(entry.pluginId, entry.verb);
		for (const testCase of entry.cases) {
			const verdict = testCase.valid ? "valid" : `invalid(${testCase.errorField})`;
			it(`${entry.pluginId}:${entry.verb} ${JSON.stringify(testCase.input)} → ${verdict}`, () => {
				const result = validateAgainstSchema(schema, testCase.input);
				expect(result.valid).toBe(testCase.valid);
				if (!testCase.valid) {
					// The SAME field the Rust host names — the invariant is field-level, not just pass/fail.
					expect(result.errors.map((error) => error.field)).toContain(testCase.errorField);
				}
			});
		}
	}
});
