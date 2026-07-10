/**
 * COMPAT re-export. The JSON result envelope moved to `@refarm.dev/capabilities`
 * (the capability MODEL) — a JSON envelope is surface-neutral, so it belongs with
 * the model that every surface projects, not with CLI/process primitives. The
 * shell-quoting handoff helpers that ARE genuinely CLI stay in `./command-handoff`.
 *
 * This module keeps the `@refarm.dev/cli/json-output` entry point stable for the
 * ~70 existing importers by re-exporting the canonical envelope from the kernel.
 * There is ONE implementation (in the kernel); this is a pointer, not a copy —
 * so the two cannot drift.
 */
export {
	formatJson,
	printJson,
	buildJsonSuccessEnvelope,
	buildJsonErrorEnvelope,
	type JsonErrorEnvelopeContext,
	type JsonSuccessEnvelopeInput,
	type JsonErrorEnvelopeInput,
	type JsonErrorEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
