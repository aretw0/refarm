import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dsAstroComponents, dsAstroCssImports, mdxComponents } from "./index.js";

const componentFiles = {
	Card: "Card.astro",
	MetricStrip: "MetricStrip.astro",
	CalloutSection: "CalloutSection.astro",
	ContentList: "ContentList.astro",
} as const;

function readComponent(name: keyof typeof componentFiles): string {
	return readFileSync(new URL(componentFiles[name], import.meta.url), "utf-8");
}

describe("ds-astro package contract", () => {
	it("exports stable MDX component subpaths", () => {
		expect(dsAstroComponents).toEqual(["Card", "MetricStrip", "CalloutSection", "ContentList"]);
		expect(mdxComponents).toEqual({
			Card: "@refarm.dev/ds-astro/Card.astro",
			MetricStrip: "@refarm.dev/ds-astro/MetricStrip.astro",
			CalloutSection: "@refarm.dev/ds-astro/CalloutSection.astro",
			ContentList: "@refarm.dev/ds-astro/ContentList.astro",
		});
	});

	it("documents the DS CSS imports every component must carry", () => {
		expect(dsAstroCssImports).toEqual([
			"@refarm.dev/ds/tokens.css",
			"@refarm.dev/ds/themes/tractor-green.css",
			"@refarm.dev/ds/components.css",
		]);
	});

	it("imports DS CSS in every Astro component", () => {
		for (const name of dsAstroComponents) {
			const source = readComponent(name);
			for (const cssImport of dsAstroCssImports) {
				expect(source).toContain(`import "${cssImport}"`);
			}
		}
	});

	it("renders through DS class hooks", () => {
		expect(readComponent("Card")).toContain('class="ds-card"');
		expect(readComponent("MetricStrip")).toContain('class="ds-grid"');
		expect(readComponent("CalloutSection")).toContain('class="ds-feedback"');
		expect(readComponent("ContentList")).toContain("ds-content-list");
	});

	it("keeps the package product neutral and app independent", () => {
		const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
		for (const forbidden of ["vault-seed", "dgk", "homestead", "apps/site", "apps/refarm"]) {
			expect(packageJson).not.toContain(forbidden);
			for (const name of dsAstroComponents) {
				expect(readComponent(name)).not.toContain(forbidden);
			}
		}
	});
});
