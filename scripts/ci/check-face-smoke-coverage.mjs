#!/usr/bin/env node
/**
 * check-face-smoke-coverage.mjs
 *
 * Every web face an example ships — each `examples/<ex>/src/pages/*.astro` page — MUST have an entry
 * in the web-face smoke's FACES manifest. Otherwise that page boots in NO real browser in CI and can
 * silently regress (a static node import crashing its bundle goes unseen). The /lab/ face was exactly
 * this: a live page with no FACES entry, so it was never smoke-covered until someone noticed by hand.
 *
 * This makes that class of gap impossible to reintroduce: add a page, and CI fails until it is wired
 * into FACES. It imports the smoke's exported FACES (no Chromium — the smoke guards main()) and walks
 * the example pages on disk.
 *
 * Route mapping: `index.astro` → "/", `<name>.astro` → "/<name>/". Pure filesystem + the FACES array,
 * no build. Exit 0 clean, 1 on any uncovered page.
 *
 * Usage: node scripts/ci/check-face-smoke-coverage.mjs
 */
import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { FACES } from "./web-face-smoke.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXAMPLES = join(ROOT, "examples");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/** The route a page file serves: index.astro → "/", governance.astro → "/governance/". */
function routeForPage(file) {
	const base = file.replace(/\.astro$/, "");
	return base === "index" ? "/" : `/${base}/`;
}

/** Every { example, route } the smoke covers — the set a page must be a member of. */
function smokeCoverage() {
	const set = new Set();
	for (const face of FACES) {
		if (face.example && face.route) set.add(`${face.example}::${face.route}`);
	}
	return set;
}

function main() {
	const covered = smokeCoverage();
	const problems = [];
	let pageCount = 0;

	for (const example of readdirSync(EXAMPLES, { withFileTypes: true })) {
		if (!example.isDirectory()) continue;
		const pagesDir = join(EXAMPLES, example.name, "src", "pages");
		if (!existsSync(pagesDir)) continue; // an example with no web presence
		const pages = readdirSync(pagesDir).filter((f) => f.endsWith(".astro"));
		for (const page of pages) {
			pageCount += 1;
			const route = routeForPage(page);
			if (!covered.has(`${example.name}::${route}`)) {
				problems.push(
					`examples/${example.name}/src/pages/${page} (route '${route}') has NO web-face smoke entry → it ` +
						`boots in no real browser in CI and can silently regress. Add { example: "${example.name}", ` +
						`route: "${route}", mustHave: [...] } to FACES in scripts/ci/web-face-smoke.mjs.`,
				);
			}
		}
	}

	if (problems.length) {
		console.error(red(`✗ check-face-smoke-coverage: ${problems.length} uncovered face page(s)`));
		for (const p of problems) console.error(`  - ${p}`);
		process.exit(1);
	}
	console.log(green(`✓ check-face-smoke-coverage: all ${pageCount} example face pages covered by the web-face smoke`));
}

main();
