import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

function walkHtmlFiles(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			walkHtmlFiles(full, out);
			continue;
		}
		if (full.endsWith(".html")) out.push(full);
	}
	return out;
}

function normalizeBase(base) {
	if (!base || base === "/") return "/";
	let value = base.trim();
	if (!value.startsWith("/")) value = `/${value}`;
	if (!value.endsWith("/")) value = `${value}/`;
	return value;
}

function collectAbsoluteRootLinks(html) {
	const links = [];
	for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
		const value = match[1];
		if (!value.startsWith("/")) continue;
		if (value.startsWith("//")) continue;
		links.push(value);
	}
	return links;
}

const distDir = process.argv[2] || "apps/dev/dist";
const expectedBase = normalizeBase(process.argv[3] || process.env.ASTRO_BASE || "/");

if (expectedBase === "/") {
	console.log("[check-astro-base-links] ASTRO_BASE is '/'; skipping strict base-prefix check.");
	process.exit(0);
}

const htmlFiles = walkHtmlFiles(distDir);
const violations = [];

for (const file of htmlFiles) {
	const html = readFileSync(file, "utf-8");
	for (const link of collectAbsoluteRootLinks(html)) {
		if (!link.startsWith(expectedBase)) {
			violations.push({ file, link });
		}
	}
}

if (violations.length > 0) {
	console.error(
		`[check-astro-base-links] Found ${violations.length} absolute root link(s) outside base '${expectedBase}'.`,
	);
	for (const violation of violations.slice(0, 50)) {
		console.error(`- ${violation.file}: ${violation.link}`);
	}
	process.exit(1);
}

console.log(
	`[check-astro-base-links] OK: ${htmlFiles.length} html file(s) validated with base '${expectedBase}'.`,
);
