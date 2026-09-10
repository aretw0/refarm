import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AGENT_RESPOND_FN, taskWorkClass } from "./types.js";

describe("taskWorkClass", () => {
	it("reads a respond turn as a model call", () => {
		expect(taskWorkClass("respond")).toBe("agent");
	});

	it("reads an absent fn as a model call, because the host defaults to respond", () => {
		expect(taskWorkClass(undefined)).toBe("agent");
		expect(taskWorkClass(null)).toBe("agent");
	});

	it("reads any other verb as ordinary computation", () => {
		expect(taskWorkClass("ingest")).toBe("dispatch");
		expect(taskWorkClass("push")).toBe("dispatch");
	});
});

/**
 * THE GUARD THAT MATTERS. The rule above is the HOST's, spelled in Rust, and the two cannot
 * share code. Restating a constant in a second language is how the copies drift, so this reads
 * the Rust source and asserts it still says what this module claims it says.
 *
 * The same device `PROCESS_HANDOFF_OUTPUT_CAP_BYTES` uses for its host twin: read from source,
 * never guessed.
 */
describe("the host's own rule", () => {
	const DISPATCH_RS = path.resolve(
		__dirname,
		"../../tractor/src/sidecar/dispatch.rs",
	);

	it("still classifies respond as agent and everything else as dispatch", () => {
		const source = readFileSync(DISPATCH_RS, "utf-8");
		// The arms of `effort_activity_kind`, whitespace-insensitive.
		const normalised = source.replace(/\s+/g, " ");
		expect(normalised).toContain(`Some("${AGENT_RESPOND_FN}") | None => "agent"`);
		expect(normalised).toContain('Some(_) => "dispatch"');
	});
});
