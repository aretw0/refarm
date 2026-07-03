import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { projectContentToRecords, validateProjectedRecords } from "../../packages/content-projection/dist/index.js";
import { mdxComponents } from "../../packages/ds-astro/dist/index.js";

const fixturePath = "apps/site/src/content/ds-astro-proof.mdx";
const text = readFileSync(fixturePath, "utf8");

for (const componentPath of Object.values(mdxComponents)) {
	assert.match(text, new RegExp(componentPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

const records = projectContentToRecords(
	[
		{
			path: fixturePath,
			text,
			mediaType: "text/mdx",
		},
	],
	{
		defaultType: ["KnowledgeRecord", "RenderProof"],
		fieldMap: { status: "state" },
	},
);

assert.equal(records.length, 1);
assert.equal(records[0]?.["content-projection:mediaType"], "text/mdx");
assert.deepEqual(records[0]?.fields, {
	title: "DS Astro proof",
	state: "active",
});

const validation = validateProjectedRecords(records);
assert.equal(validation.ok, true, JSON.stringify(validation.failures, null, 2));
