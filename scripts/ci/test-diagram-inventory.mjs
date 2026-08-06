import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDiagramInventory, renderDiagramInventoryMarkdown } from "./lib/diagram-inventory.mjs";

test("diagram inventory reports deterministic source-to-SVG coverage", () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-diagram-inventory-"));
	try {
		mkdirSync(join(root, "docs/diagrams"), { recursive: true });
		mkdirSync(join(root, "specs/diagrams"), { recursive: true });
		mkdirSync(join(root, "examples/demo/diagrams"), { recursive: true });
		mkdirSync(join(root, "examples/demo/node_modules/ignored"), { recursive: true });
		writeFileSync(join(root, "docs/diagrams/a.mermaid"), "flowchart LR\n A --> B\n");
		writeFileSync(join(root, "docs/diagrams/a.svg"), "<svg/>\n");
		writeFileSync(join(root, "specs/diagrams/b.mermaid"), "flowchart LR\n B --> C\n");
		writeFileSync(join(root, "examples/demo/diagrams/c.mermaid"), "flowchart LR\n C --> D\n");
		writeFileSync(join(root, "examples/demo/diagrams/c.svg"), "<svg/>\n");
		writeFileSync(join(root, "examples/demo/node_modules/ignored/d.mermaid"), "flowchart LR\n D --> E\n");
		writeFileSync(join(root, "docs/diagrams/GUIDE.md"), "# Legacy\n");
		writeFileSync(join(root, "specs/diagrams/GUIDE.md"), "# Target\n");
		writeFileSync(join(root, "specs/diagrams/governance.v1.json"), `${JSON.stringify({
			version: 1,
			families: [
				{
					id: "target",
					topic: "example",
					state: "consolidation-target",
					guide: "specs/diagrams/GUIDE.md",
					sourcePrefix: "specs/diagrams/b",
					sources: ["specs/diagrams/b.mermaid"],
				},
				{
					id: "legacy",
					topic: "example",
					state: "legacy-frozen",
					guide: "docs/diagrams/GUIDE.md",
					sourcePrefix: "docs/diagrams/a",
					sources: ["docs/diagrams/a.mermaid"],
				},
			],
		}, null, 2)}\n`);

		const report = buildDiagramInventory({ root });
		assert.equal(report.ok, false);
		assert.deepEqual(report.summary, {
			sources: 3,
			rendered: 2,
			missing: 1,
			byArea: { docs: 1, "specs/diagrams": 1, examples: 1 },
			byLifecycle: { "legacy-frozen": 1, unclassified: 1, "consolidation-target": 1 },
		});
		assert.deepEqual(report.missingRenderings, ["specs/diagrams/b.svg"]);
		assert.deepEqual(report.governance.violations, []);
		assert.equal(report.diagrams.find((diagram) => diagram.source === "docs/diagrams/a.mermaid")?.lifecycle, "legacy-frozen");
		assert.match(renderDiagramInventoryMarkdown(report), /specs\/diagrams\/b\.svg.*\*\*no\*\*/);
		assert.deepEqual(buildDiagramInventory({ root }), report);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("diagram inventory rejects undeclared members of a governed family", () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-diagram-governance-"));
	try {
		mkdirSync(join(root, "specs/diagrams"), { recursive: true });
		writeFileSync(join(root, "specs/diagrams/GUIDE.md"), "# Guide\n");
		writeFileSync(join(root, "specs/diagrams/arch.mermaid"), "flowchart LR\n A --> B\n");
		writeFileSync(join(root, "specs/diagrams/arch.svg"), "<svg/>\n");
		writeFileSync(join(root, "specs/diagrams/arch--new.mermaid"), "flowchart LR\n B --> C\n");
		writeFileSync(join(root, "specs/diagrams/arch--new.svg"), "<svg/>\n");
		writeFileSync(join(root, "specs/diagrams/governance.v1.json"), `${JSON.stringify({
			version: 1,
			families: [{
				id: "architecture",
				topic: "system",
				state: "consolidation-target",
				guide: "specs/diagrams/GUIDE.md",
				sourcePrefix: "specs/diagrams/arch",
				sources: ["specs/diagrams/arch.mermaid"],
			}],
		}, null, 2)}\n`);

		const report = buildDiagramInventory({ root });
		assert.equal(report.ok, false);
		assert.equal(report.governance.violations[0]?.type, "family-membership-drift");
		assert.deepEqual(report.governance.violations[0]?.discovered, [
			"specs/diagrams/arch--new.mermaid",
			"specs/diagrams/arch.mermaid",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
