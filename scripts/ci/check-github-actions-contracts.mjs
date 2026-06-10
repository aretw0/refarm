#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const setupActionPath = join(root, ".github", "actions", "setup", "action.yml");
const setupAction = readFileSync(setupActionPath, "utf8");

const failures = [];

function sectionAfter(name) {
	const marker = `- name: ${name}`;
	const start = setupAction.indexOf(marker);
	if (start === -1) return "";

	const next = setupAction.indexOf("\n    - name:", start + marker.length);
	return setupAction.slice(start, next === -1 ? setupAction.length : next);
}

function assertIncludes(section, needle, message) {
	if (!section.includes(needle)) failures.push(message);
}

const installDependencies = sectionAfter("Install dependencies");
if (!installDependencies) {
	failures.push("setup action is missing the Install dependencies step");
} else {
	assertIncludes(
		installDependencies,
		'PUPPETEER_SKIP_DOWNLOAD: "true"',
		"Install dependencies must skip Puppeteer browser downloads",
	);
	assertIncludes(
		installDependencies,
		'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"',
		"Install dependencies must skip Playwright browser downloads",
	);
	assertIncludes(
		installDependencies,
		"pnpm install --frozen-lockfile",
		"Install dependencies must keep deterministic pnpm install",
	);
}

const setupPlaywright = sectionAfter("Setup Playwright browsers");
if (!setupPlaywright) {
	failures.push("setup action is missing the explicit Playwright browser setup step");
} else {
	assertIncludes(
		setupPlaywright,
		"if: ${{ inputs.playwright-setup == 'true' }}",
		"Playwright browser setup must remain opt-in",
	);
	assertIncludes(
		setupPlaywright,
		"$PW_CMD install chromium firefox webkit",
		"Playwright browser setup must explicitly install required browsers",
	);
}

if (failures.length === 0) {
	console.log("✓ GitHub Actions setup contracts are valid");
	process.exit(0);
}

console.error("✗ GitHub Actions setup contract violations\n");
for (const failure of failures) {
	console.error(`  - ${failure}`);
}
process.exit(1);
