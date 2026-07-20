import { buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import type { CapabilityDescriptor, CapabilityEnvelope, CapabilityInput } from "@refarm.dev/capabilities";

/**
 * `greet` — Greet a recipient (a neutral, generated sample proving the scaffold emits working code).
 *
 * Declared ONCE. This descriptor projects to the CLI, a web form, an agent tool, and an HTTP route; its
 * typed args/options derive one JSON Schema that validates the SAME on every surface (see greet.test.ts).
 * Fill in run() — its input is already parsed + validated against that schema.
 */
export const greetCapability: CapabilityDescriptor = {
	name: "greet",
	summary: "Greet a recipient (a neutral, generated sample proving the scaffold emits working code)",
	args: [
		{"name":"to","required":true,"type":"string","description":"Who to greet"},
	],
	options: [
		{"name":"times","kind":"integer","summary":"How many times to repeat the greeting"},
	],
	transports: { http: { method: "POST", path: "/greet" } },
	renderers: { web: {}, tui: { section: "actions" } },
	run(_input: CapabilityInput): CapabilityEnvelope {
		// TODO: implement. `_input.args` / `_input.options` are parsed + schema-validated already.
		return buildJsonSuccessEnvelope({ command: "greet", operation: "greet" });
	},
};
