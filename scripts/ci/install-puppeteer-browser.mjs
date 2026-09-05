#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache", "puppeteer");

export function resolveDiagramBrowserPlan({ root = ROOT, cacheDir = CACHE_DIR } = {}) {
	const rootRequire = createRequire(path.join(root, "package.json"));
	const mermaidCliEntry = rootRequire.resolve("@mermaid-js/mermaid-cli");
	const mermaidCliPackage = JSON.parse(readFileSync(path.join(path.dirname(path.dirname(mermaidCliEntry)), "package.json"), "utf8"));
	const mermaidRequire = createRequire(mermaidCliEntry);
	const puppeteerCoreEntry = mermaidRequire.resolve("puppeteer-core");
	const revisions = mermaidRequire("puppeteer-core/internal/revisions.js");
	const chromeRevision = revisions.PUPPETEER_REVISIONS?.["chrome-headless-shell"];
	if (!chromeRevision) {
		throw new Error(`Could not read chrome-headless-shell revision used by ${puppeteerCoreEntry}.`);
	}
	return {
		browserSpec: `chrome-headless-shell@${chromeRevision}`,
		cacheDir,
		mermaidCliEntry,
		mermaidCliVersion: mermaidCliPackage.version,
		puppeteerCoreEntry,
	};
}

async function main() {
	const plan = resolveDiagramBrowserPlan();
	if (process.argv.includes("--dry-run")) {
		console.log(JSON.stringify({ ok: true, ...plan }, null, 2));
		return;
	}
	const result = spawnSync(
		"pnpm",
		["dlx", "@puppeteer/browsers", "install", plan.browserSpec, "--path", plan.cacheDir],
		{ cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
	);
	if (result.status !== 0) process.exit(result.status ?? 1);
	console.log(`Installed ${plan.browserSpec} into ${plan.cacheDir}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	await main();
}
