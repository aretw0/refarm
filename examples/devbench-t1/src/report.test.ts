import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { buildDevbenchReport } from "./report.js";
import { DEVBENCH_DEFAULT_MANIFESTS, DEVBENCH_LIVE_MANIFESTS, DEVBENCH_LIVE_PLUGIN_IDS } from "./persona.js";

describe("report — the T1 record material", () => {
	it("builds a standalone SPI graph SVG + a markdown report with real numbers", () => {
		const files = buildDevbenchReport([...DEVBENCH_DEFAULT_MANIFESTS, ...DEVBENCH_LIVE_MANIFESTS], {
			livePluginIds: DEVBENCH_LIVE_PLUGIN_IDS,
		});
		const svg = files.find((f) => f.path.endsWith(".svg"));
		const md = files.find((f) => f.path.endsWith(".md"));
		// The SPI graph is a standalone SVG document.
		expect(svg?.content).toContain("<svg");
		// The report cites the EXECUTED edge (delegate → agent), a real number not an assertion.
		expect(md?.content).toContain("delegate → agent");
		expect(md?.content).toContain("executada (ao vivo)");
		// It references the figures a writeup embeds.
		expect(md?.content).toContain("diagrams/composition.svg");
		expect(md?.content).toContain(".dgk/report/spi-graph.svg");
	});

	it("is mounted with an IDE command, and report-only mode returns the markdown", async () => {
		const verb = buildRegistry().get("report");
		if (!verb || "actions" in verb) throw new Error("report not mounted");
		expect((verb.renderers?.ide as { command?: string } | undefined)?.command).toBe("dgk.report");
		const env = (await verb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			applied: boolean;
			files: Array<{ path: string }>;
			markdown?: string;
		};
		expect(env.ok).toBe(true);
		expect(env.applied).toBe(false); // no --apply → report only, nothing written
		expect(env.files.map((f) => f.path).sort()).toEqual([".dgk/report/T1-report.md", ".dgk/report/spi-graph.svg"]);
		expect(env.markdown).toContain("o que o exemplo prova");
	});
});
