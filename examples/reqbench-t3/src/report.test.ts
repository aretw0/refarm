import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { buildReqbenchReport } from "./report.js";

describe("requirements-report — the T3 record material", () => {
	it("is mounted and report-only mode returns a markdown of the vault state", async () => {
		const verb = buildRegistry().get("requirements-report");
		if (!verb || "actions" in verb) throw new Error("requirements-report not mounted");
		expect((verb.renderers?.ide as { command?: string } | undefined)?.command).toBe("dgk.requirements-report");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			applied: boolean;
			markdown?: string;
		};
		expect(env.ok).toBe(true);
		expect(env.applied).toBe(false);
		// The report cites the corpus by real sections, and references the figures.
		expect(env.markdown).toContain("o estado do vault");
		expect(env.markdown).toContain("Cobertura");
		expect(env.markdown).toContain("Saúde do corpus");
		expect(env.markdown).toContain("diagrams/composition.svg");
	});

	it("buildReqbenchReport writes to .dgk/report (ephemeral) with a real total", () => {
		const files = buildReqbenchReport({ loadManifest: () => ({ manifestVersion: 1, records: [] }) } as never);
		expect(files[0]?.path).toBe(".dgk/report/T3-report.md");
		expect(files[0]?.content).toContain("0 requisitos no vault");
	});
});
