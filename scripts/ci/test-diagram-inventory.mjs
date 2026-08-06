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

		const report = buildDiagramInventory({ root });
		assert.equal(report.ok, false);
		assert.deepEqual(report.summary, {
			sources: 3,
			rendered: 2,
			missing: 1,
			byArea: { docs: 1, "specs/diagrams": 1, examples: 1 },
		});
		assert.deepEqual(report.missingRenderings, ["specs/diagrams/b.svg"]);
		assert.match(renderDiagramInventoryMarkdown(report), /specs\/diagrams\/b\.svg.*\*\*no\*\*/);
		assert.deepEqual(buildDiagramInventory({ root }), report);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
