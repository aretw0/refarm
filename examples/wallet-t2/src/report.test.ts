import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";

describe("report — the T2 record material", () => {
	it("is mounted and report-only mode returns the disclosure graph + a markdown of the posture", async () => {
		const verb = buildRegistry({ statePath: undefined }).get("report");
		if (!verb || "actions" in verb) throw new Error("report not mounted");
		expect((verb.renderers?.ide as { command?: string } | undefined)?.command).toBe("dgk.report");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			applied: boolean;
			files: Array<{ path: string }>;
			markdown?: string;
		};
		expect(env.ok).toBe(true);
		expect(env.applied).toBe(false);
		// The two files: the disclosure graph SVG + the report markdown.
		expect(env.files.map((f) => f.path).sort()).toEqual([".dgk/report/T2-report.md", ".dgk/report/disclosure-graph.svg"]);
		// The report cites credentials + consent + the figures.
		expect(env.markdown).toContain("minha soberania");
		expect(env.markdown).toContain("Credenciais");
		expect(env.markdown).toContain("Consentimentos");
		expect(env.markdown).toContain("diagrams/flow.svg");
	});
});
