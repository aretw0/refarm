// Surface-agnostic capability argument validation. A capability's args/options derive ONE JSON Schema
// (capabilityToolParameters — the same schema the agent tool exposes); this validates a collected input
// object against it with Ajv, so a web form, a CLI prompt, and an agent tool call all enforce the SAME
// contract and reject the same bad input consistently. No brand or surface name leaks here — it is pure
// schema validation, reusable by any renderer.

import Ajv, { type ErrorObject } from "ajv";

import { capabilityToolParameters } from "./agent-projector.js";
import type { CapabilityDescriptor } from "./types.js";

/** One validation failure: the arg/option name it concerns (`""` for a whole-input error) + a
 * human-readable message. Surface-neutral, so any renderer (web form, CLI, agent) can present it. */
export interface CapabilityArgError {
	field: string;
	message: string;
}

export interface CapabilityArgValidation {
	valid: boolean;
	errors: CapabilityArgError[];
}

// Ajv ships as CJS with an ESM-interop default; unwrap a possible nested `default` so `new AjvCtor()`
// works whether the module resolves to the class or an ESM namespace wrapper.
const AjvCtor = ((Ajv as unknown as { default?: typeof Ajv }).default ?? Ajv) as typeof Ajv;

/** A shared Ajv tuned for form-style input: coerce string values to the schema's types (a web form
 * yields "42"/"true"), report every error (not just the first), and stay lenient about annotation
 * keywords (`description`) carried by the derived schema. */
const ajv = new AjvCtor({ coerceTypes: true, allErrors: true, strict: false });

/** Map an Ajv error to a field-scoped {@link CapabilityArgError}: a `required` error names the missing
 * property; any other error is scoped by its instance path (`/query` → `query`). */
function toArgError(error: ErrorObject): CapabilityArgError {
	if (error.keyword === "required") {
		const missing = (error.params as { missingProperty?: string }).missingProperty;
		return { field: missing ?? "", message: "is required" };
	}
	return { field: error.instancePath.replace(/^\//, ""), message: error.message ?? "is invalid" };
}

/**
 * Validate an input object against a raw JSON Schema with the shared form-tuned Ajv — the primitive
 * {@link validateCapabilityArgs} builds on, and the exact TS twin of the Rust host's `validate_tool_input`
 * (jsonschema). A cross-language conformance test drives BOTH with the SAME schema bytes + inputs (see
 * capabilities-v1's verb-schema-validation.test and tractor's validate_tool_input_matches_ts_conformance_
 * fixture). ONE deliberate difference: this Ajv COERCES string form-input to the schema's types (a web
 * `<input>` yields "42"), while the Rust host does not (an agent/plugin sends already-typed JSON) — so
 * the shared cases stay coercion-stable.
 */
export function validateAgainstSchema(
	schema: object,
	input: Record<string, unknown>,
): CapabilityArgValidation {
	const validate = ajv.compile(schema);
	const data: Record<string, unknown> = { ...input };
	if (validate(data)) return { valid: true, errors: [] };
	return { valid: false, errors: (validate.errors ?? []).map(toArgError) };
}

/**
 * Validate a flat `{ ...args, ...options }` input against the capability's DERIVED JSON Schema — the same
 * schema the agent sees, so every surface enforces one contract. Ajv `coerceTypes` handles string-typed
 * inputs; validation is read-only for the caller (it checks a shallow copy, so the caller's object is
 * left untouched). A descriptor with no args/options yields an empty schema and always validates.
 */
export function validateCapabilityArgs(
	descriptor: Pick<CapabilityDescriptor, "args" | "options">,
	input: Record<string, unknown>,
): CapabilityArgValidation {
	return validateAgainstSchema(capabilityToolParameters(descriptor as CapabilityDescriptor), input);
}
