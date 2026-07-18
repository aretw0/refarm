#!/usr/bin/env node
// Real-browser smoke for the examples' web faces — the deterministic backstop for the B1 class of
// bug (a static node/commander import that crashes a browser bundle at module-init, which jsdom
// CANNOT catch: only a real headless Chromium boot reveals it). It boots each declared face, asserts
// the loading overlay is removed + ZERO page errors + the face's key content is present, and runs a
// short interaction (the B2 dispatch loop painting a verb's result).
//
// ADD A FACE: append one entry to FACES below. A new browser-safe face is then covered by
// construction — no bespoke harness, no way to silently regress. That is the whole point: faces
// proliferate WITHOUT proliferating untested regressions. check-face-smoke-coverage.mjs imports the
// exported FACES and asserts every example page (src/pages/*.astro) has an entry, so a NEW page that
// forgets its FACES entry fails CI deterministically (the /lab/ hole can never recur).
//
// GATED: if no Chromium (CHROME_PATH / puppeteer cache / playwright cache / system) or puppeteer-core
// is resolvable, it SKIPS with a notice and exits 0 — so it never reds CI where a browser is absent
// (mirrors the WASM-component skipIf convention). Exits 1 on any real face failure.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── The face manifest — ONE entry per browser-safe face. ──────────────────────────────────────
// example: dir under examples/; route: the built page; mustHave: selectors present on boot;
// interact (optional): { fill?: [selector, value], click: selector, expect: selector } — a minimal
// user action whose result must appear (proves the dispatch loop / B2 in a real browser).
// Exported so check-face-smoke-coverage.mjs can assert every example page has an entry.
export const FACES = [
	// The landing hubs — the browser-safe front door of each example, linking to its live faces.
	{ work: "T1", example: "devbench-t1", route: "/", mustHave: ["[data-face-hub]", 'a[href="/governance/"]', 'a[href="/extension-graph/"]'] },
	{ work: "T2", example: "wallet-t2", route: "/", mustHave: ["[data-face-hub]", 'a[href="/consent/"]'] },
	{ work: "T3", example: "reqbench-t3", route: "/", mustHave: ["[data-face-hub]", 'a[href="/search/"]', 'a[href="/graph/"]', 'a[href="/lab/"]'] },
	{
		work: "T2",
		example: "wallet-t2",
		route: "/consent/",
		mustHave: [".refarm-consent-seed"],
		interact: { click: ".refarm-consent-seed", expect: '[data-refarm-surface-action-id="authorization-authorize"]' },
	},
	{
		work: "T3",
		example: "reqbench-t3",
		route: "/search/",
		mustHave: ['[data-refarm-verb="requirements-search"]', '[data-refarm-arg="query"]'],
		interact: {
			fill: ['[data-refarm-arg="query"]', "CNPJ"],
			click: '[data-refarm-verb="requirements-search"] [data-refarm-surface-action-id="requirements-search"]',
			expect: "[data-refarm-action-result] [data-search-results]",
		},
	},
	{
		work: "T3",
		example: "reqbench-t3",
		route: "/graph/",
		// The interactive force-directed network mounts into #graph-mount as an SVG (Surveyor).
		mustHave: ["#graph-mount svg"],
	},
	{
		work: "T3",
		example: "reqbench-t3",
		route: "/lab/",
		// The Lab gallery renders notebook cards ([data-notebook-href]) into #lab-mount from the
		// requirements-lab manifest — now a browser-safe registry (lab-app.ts → ../lab.ts), so it
		// boots without dragging the node-bound CLI into the bundle (the reason it had no smoke).
		mustHave: ["#lab-mount [data-notebook-href]"],
	},
	{
		work: "T1",
		example: "devbench-t1",
		route: "/governance/",
		mustHave: ["[data-governance-dashboard]"],
		interact: { click: '[data-refarm-surface-action-id="governance-poc"]', expect: "[data-refarm-action-result]" },
	},
	{
		work: "T1",
		example: "devbench-t1",
		route: "/extension-graph/",
		mustHave: ["svg"],
		interact: { click: '[data-refarm-surface-action-id="extension-graph"]', expect: "[data-refarm-action-result] svg" },
	},
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".woff": "font/woff" };

function skip(reason) {
	console.log(`::notice::web-face-smoke SKIPPED — ${reason}`);
	process.exit(0);
}

function resolvePuppeteer() {
	const attempts = [
		() => createRequire(join(REPO_ROOT, "packages/browser-driver/package.json"))("puppeteer-core"),
		() => createRequire(join(REPO_ROOT, "package.json"))("puppeteer-core"),
	];
	for (const a of attempts) {
		try {
			return a();
		} catch {
			/* try next */
		}
	}
	return null;
}

function findChrome() {
	if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
	const globs = [
		["/home/vscode/.cache/puppeteer/chrome", (b) => join(b, "chrome-linux64", "chrome")],
		[join(process.env.HOME || "", ".cache/puppeteer/chrome"), (b) => join(b, "chrome-linux64", "chrome")],
		[join(process.env.HOME || "", ".cache/ms-playwright"), (b) => join(b, "chrome-linux", "chrome")],
	];
	for (const [root, toBin] of globs) {
		try {
			for (const entry of readdirSync(root)) {
				const bin = toBin(join(root, entry));
				if (existsSync(bin)) return bin;
			}
		} catch {
			/* dir absent */
		}
	}
	for (const p of ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
		if (existsSync(p)) return p;
	}
	return null;
}

function serve(root) {
	const server = http.createServer(async (req, res) => {
		try {
			let p = decodeURIComponent((req.url || "/").split("?")[0]);
			if (p.endsWith("/")) p += "index.html";
			let file = join(root, p);
			if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
			const body = await readFile(file);
			res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
			res.end(body);
		} catch {
			res.writeHead(404);
			res.end("not found");
		}
	});
	return server;
}

async function checkFace(browser, port, face) {
	const failures = [];
	const page = await browser.newPage();
	const pageErrors = [];
	page.on("pageerror", (e) => pageErrors.push(String(e.message).split("\n")[0]));
	page.on("requestfailed", (r) => {
		// A failed module/script request is a real boot failure; ignore favicon.
		const url = r.url();
		if (!url.endsWith("/favicon.ico")) pageErrors.push(`requestfailed ${url}: ${r.failure()?.errorText ?? ""}`);
	});
	try {
		await page.goto(`http://127.0.0.1:${port}${face.route}`, { waitUntil: "networkidle0", timeout: 25000 });
		await new Promise((r) => setTimeout(r, 700));
		if (await page.$("#loading-overlay")) failures.push("loading overlay still present (face did not boot)");
		for (const sel of face.mustHave ?? []) {
			if (!(await page.$(sel))) failures.push(`missing required selector: ${sel}`);
		}
		if (face.interact) {
			if (face.interact.fill) {
				const [sel, value] = face.interact.fill;
				await page.$eval(sel, (el) => (el.value = "")).catch(() => {});
				await page.type(sel, value);
			}
			await page.click(face.interact.click).catch((e) => failures.push(`click ${face.interact.click} failed: ${e.message}`));
			// Wait for the expected result to appear (the dispatch loop / B2 render).
			const ok = await page
				.waitForSelector(face.interact.expect, { timeout: 4000 })
				.then(() => true)
				.catch(() => false);
			if (!ok) failures.push(`interaction result not shown: ${face.interact.expect}`);
		}
		if (pageErrors.length) failures.push(`page errors: ${JSON.stringify(pageErrors)}`);
	} catch (e) {
		failures.push(`navigation/boot threw: ${e instanceof Error ? e.message : String(e)}`);
	} finally {
		await page.close().catch(() => {});
	}
	return failures;
}

async function main() {
	const puppeteer = resolvePuppeteer();
	if (!puppeteer) skip("puppeteer-core is not resolvable (browser-driver optional dep not installed)");
	const chrome = findChrome();
	if (!chrome) skip("no Chromium found (set CHROME_PATH, or install the puppeteer/playwright browser)");

	// Every declared face's example must have a built web bundle.
	const missing = [...new Set(FACES.map((f) => f.example))].filter(
		(ex) => !existsSync(join(REPO_ROOT, "examples", ex, "dist-web")),
	);
	if (missing.length) {
		console.error(`::error::web-face-smoke — dist-web missing for: ${missing.join(", ")}. Run: pnpm --filter ${missing.join(",")} run web:build`);
		process.exit(1);
	}

	console.log(`web-face-smoke — Chromium: ${chrome}\n  faces: ${FACES.length}`);
	const browser = await puppeteer.launch({
		headless: true,
		executablePath: chrome,
		args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
	});
	let failed = 0;
	try {
		// Group faces by example so each example's dist-web is served once.
		for (const example of [...new Set(FACES.map((f) => f.example))]) {
			const server = serve(join(REPO_ROOT, "examples", example, "dist-web"));
			await new Promise((r) => server.listen(0, "127.0.0.1", r));
			const port = server.address().port;
			try {
				for (const face of FACES.filter((f) => f.example === example)) {
					const failures = await checkFace(browser, port, face);
					if (failures.length) {
						failed += 1;
						console.error(`  ✗ ${face.work} ${example}${face.route}`);
						for (const f of failures) console.error(`      - ${f}`);
					} else {
						console.log(`  ✓ ${face.work} ${example}${face.route}`);
					}
				}
			} finally {
				server.close();
			}
		}
	} finally {
		await browser.close();
	}
	if (failed) {
		console.error(`::error::web-face-smoke — ${failed}/${FACES.length} face(s) FAILED`);
		process.exit(1);
	}
	console.log(`web-face-smoke — all ${FACES.length} faces booted + interacted in a real browser ✓`);
}

// Run only when invoked directly (`node web-face-smoke.mjs`), not when imported for its FACES export
// (check-face-smoke-coverage.mjs) — importing must not launch Chromium.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	main().catch((e) => {
		console.error("::error::web-face-smoke crashed", e);
		process.exit(1);
	});
}
