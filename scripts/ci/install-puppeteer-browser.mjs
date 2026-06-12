#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const PNPM_STORE = path.join(ROOT, "node_modules", ".pnpm");
const CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || path.join(os.homedir(), ".cache", "puppeteer");

function findPuppeteerCoreRevisionFile() {
	if (!existsSync(PNPM_STORE)) {
		throw new Error(`Missing pnpm store at ${PNPM_STORE}. Run pnpm install first.`);
	}

	const candidates = readdirSync(PNPM_STORE)
		.filter((entry) => entry.startsWith("puppeteer-core@"))
		.sort()
		.reverse()
		.map((entry) =>
			path.join(PNPM_STORE, entry, "node_modules", "puppeteer-core", "lib", "esm", "puppeteer", "revisions.js"),
		)
		.filter((candidate) => existsSync(candidate));

	if (candidates.length === 0) {
		throw new Error("Could not find puppeteer-core revisions.js under node_modules/.pnpm.");
	}

	return candidates[0];
}

const revisionFile = findPuppeteerCoreRevisionFile();
const revisions = await import(pathToFileURL(revisionFile).href);
const chromeRevision = revisions.PUPPETEER_REVISIONS?.["chrome-headless-shell"];

if (!chromeRevision) {
	throw new Error(`Could not read chrome-headless-shell revision from ${revisionFile}.`);
}

const browserSpec = `chrome-headless-shell@${chromeRevision}`;

if (process.argv.includes("--dry-run")) {
	console.log(JSON.stringify({ ok: true, browserSpec, cacheDir: CACHE_DIR, revisionFile }, null, 2));
	process.exit(0);
}

const result = spawnSync(
	"pnpm",
	["dlx", "@puppeteer/browsers", "install", browserSpec, "--path", CACHE_DIR],
	{ cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" },
);

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

console.log(`Installed ${browserSpec} into ${CACHE_DIR}`);
