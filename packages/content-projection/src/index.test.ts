import { describe, expect, it } from "vitest";

import {
	buildContentIdIndex,
	extractExternalMarkdownLinks,
	extractMarkdownLinks,
	extractWikilinks,
	parseFrontmatter,
	projectContentToRecords,
	resolveMarkdownLinks,
	resolveWikilinks,
	validateProjectedRecords,
} from "./index.js";

describe("content projection", () => {
	it("splits YAML frontmatter from Markdown body", () => {
		const parsed = parseFrontmatter("---\ntitle: Hello\ntags:\n  - demo\n---\n# Body\n");

		expect(parsed.data).toEqual({ title: "Hello", tags: ["demo"] });
		expect(parsed.body).toBe("# Body\n");
		expect(parsed.frontmatter).toContain("title: Hello");
	});

	it("returns an empty data object when frontmatter is absent", () => {
		const parsed = parseFrontmatter("# Plain\n");

		expect(parsed.data).toEqual({});
		expect(parsed.body).toBe("# Plain\n");
		expect(parsed.frontmatter).toBeNull();
	});

	it("degrades to empty data when the frontmatter is not valid YAML", () => {
		// Real vaults carry template files whose placeholders are not YAML:
		// `{{date}}` opens a flow map that never closes. Throwing here takes down
		// the projection of every other note because of one template.
		const parsed = parseFrontmatter("---\ncreated: {{date}} {{time}}\n---\n# Body\n");

		expect(parsed.data).toEqual({});
		expect(parsed.body).toBe("# Body\n");
		expect(parsed.frontmatter).toBe("created: {{date}} {{time}}");
	});

	it("projects a vault that contains one unparseable template", () => {
		const records = projectContentToRecords([
			// `{{date}}` alone is valid YAML — a flow map with a complex key. It is
			// the trailing content after the flow map closes that makes it a parse
			// error, which is exactly the shape Obsidian templates have.
			{ path: "templates/daily.md", text: "---\ncreated: {{date}} {{time}}\n---\nTemplate body\n" },
			{ path: "notes/real.md", text: "---\ntitle: Real\n---\nReal body\n" },
		]);

		expect(records).toHaveLength(2);
		expect(records[0]?.fields.title).toBe("daily");
		expect(records[1]?.fields.title).toBe("Real");
	});

	it("reads wikilinks out of frontmatter values when asked", () => {
		// Obsidian vaults carry typed links in frontmatter — `responsavel:
		// "[[Arthur]]"` — and a body-only scan drops them without a trace.
		const records = projectContentToRecords(
			[
				{
					path: "notes/opportunity.md",
					text: '---\nresponsavel: "[[Arthur]]"\nrevisores:\n  - "[[Lais]]"\n---\nNo links here.\n',
				},
				{ path: "people/Arthur.md", text: "Arthur\n" },
				{ path: "people/Lais.md", text: "Lais\n" },
			],
			{ linkFrontmatter: true },
		);

		expect(records[0]?.relations.map((relation) => relation.target)).toEqual([
			records[1]?.id,
			records[2]?.id,
		]);
		expect(records[0]?.relations[0]?.attrs).toMatchObject({ kind: "frontmatter", key: "responsavel" });
		expect(records[0]?.relations[1]?.attrs).toMatchObject({ kind: "frontmatter", key: "revisores" });
	});

	it("leaves frontmatter links alone unless the consumer opts in", () => {
		const records = projectContentToRecords([
			{ path: "notes/opportunity.md", text: '---\nresponsavel: "[[Arthur]]"\n---\nBody.\n' },
			{ path: "people/Arthur.md", text: "Arthur\n" },
		]);

		expect(records[0]?.relations).toEqual([]);
	});

	it("extracts wikilinks with optional labels", () => {
		expect(extractWikilinks("See [[Alpha]] and [[Beta Note|the beta]].")).toEqual([
			{ raw: "[[Alpha]]", target: "Alpha" },
			{ raw: "[[Beta Note|the beta]]", target: "Beta Note", label: "the beta" },
		]);
	});

	it("extracts Markdown inline links while skipping images", () => {
		expect(extractMarkdownLinks("See [Alpha](./Alpha.md) and ![logo](logo.png).")).toEqual([
			{ raw: "[Alpha](./Alpha.md)", label: "Alpha", target: "./Alpha.md" },
		]);
	});

	it("extracts external Markdown inline links separately", () => {
		expect(
			extractExternalMarkdownLinks("[Alpha](./Alpha.md) [External](https://example.test/doc)"),
		).toEqual([
			{
				raw: "[External](https://example.test/doc)",
				label: "External",
				target: "https://example.test/doc",
			},
		]);
	});

	it("resolves wikilinks while dropping dangling and self links", () => {
		const links = extractWikilinks("[[Alpha]] [[Missing]] [[Self]] [[Alpha]]");
		const index = new Map([
			["Alpha", "record:alpha"],
			["Self", "record:self"],
		]);

		expect(resolveWikilinks(links, index, { selfId: "record:self" })).toEqual([
			{
				type: "references",
				target: "record:alpha",
				attrs: { raw: "[[Alpha]]", label: "Alpha" },
			},
		]);
	});

	it("resolves Markdown links to local records while dropping external targets", () => {
		const links = extractMarkdownLinks("[Alpha](./Alpha.md) [External](https://example.test/doc)");
		const index = new Map([["Alpha", "record:alpha"]]);

		expect(resolveMarkdownLinks(links, index)).toEqual([
			{
				type: "references",
				target: "record:alpha",
				attrs: { raw: "[Alpha](./Alpha.md)", label: "Alpha", kind: "markdown-link" },
			},
		]);
	});

	it("builds an id index from paths, titles, slugs, and aliases", () => {
		const index = buildContentIdIndex([
			{
				path: "20 - Projects/Alpha Note.md",
				text: "---\ntitle: Alpha Note\naliases: [Alpha]\n---\n",
			},
		]);

		expect(index.get("Alpha")).toBe("record:content:20-projects/alpha-note");
		expect(index.get("Alpha Note")).toBe("record:content:20-projects/alpha-note");
		expect(index.get("20 - Projects/Alpha Note")).toBe("record:content:20-projects/alpha-note");
	});

	it("projects Markdown and MDX items to valid records:v1 records", () => {
		const records = projectContentToRecords(
			[
				{
					path: "20 - Projects/Alpha.md",
					text: "---\ntitle: Alpha\nstatus: active\n---\n# Alpha\nSee [[Beta]], [Beta file](40%20-%20Resources/Beta.mdx), and [docs](https://example.test/docs).\n",
				},
				{
					path: "40 - Resources/Beta.mdx",
					text: "---\ntitle: Beta\n---\n<Button>Open</Button>\n",
				},
			],
			{
				folderTypes: {
					"20 - Projects": ["KnowledgeRecord", "Project"],
					"40 - Resources": ["KnowledgeRecord", "Resource"],
				},
				fieldMap: { status: "state" },
				relationType: "linksTo",
			},
		);

		expect(records[0]).toMatchObject({
			id: "record:content:20-projects/alpha",
			"@type": ["KnowledgeRecord", "Project"],
			fields: { title: "Alpha", state: "active" },
			"content-projection:path": "20 - Projects/Alpha.md",
			"content-projection:mediaType": "text/markdown",
		});
		expect(records[0]?.relations).toEqual([
			{
				type: "linksTo",
				target: "record:content:40-resources/beta",
				attrs: { raw: "[[Beta]]", label: "Beta" },
			},
		]);
		expect(records[0]?.["content-projection:externalLinks"]).toEqual([
			{
				raw: "[docs](https://example.test/docs)",
				label: "docs",
				target: "https://example.test/docs",
			},
		]);
		expect(records[1]).toMatchObject({
			"@type": ["KnowledgeRecord", "Resource"],
			"content-projection:mediaType": "text/mdx",
		});

		const validation = validateProjectedRecords(records);
		expect(validation.ok).toBe(true);
		expect(validation.failures).toEqual([]);
	});
});
