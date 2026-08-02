import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseSurfaces, type SurfaceCatalog } from "@refarm.dev/std";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ATTEND_PAGE_PATH } from "./web-serve-attend.js";
import { isSidecarApiPath, startWebServeServer } from "./web-serve.js";

/**
 * `/attend`, mounted on the real `refarm web serve` listener.
 *
 * Nothing here reaches the operator's runtime. The static root is a temp directory this
 * suite builds, and `/prompts` is proxied to an in-process STUB that gates the way the
 * Rust sidecar does — so "the credential survives the proxy" and "401, 409 and a dead
 * upstream stay three different answers" are demonstrated rather than asserted.
 *
 * What is NOT tested here, and is stated plainly rather than implied: nothing in this file
 * runs a browser. The page's own logic — the client, the refusal split, the expiry
 * handling and the rendering of each prompt kind — lives in `@refarm.dev/attend-web-v1`
 * and is unit-tested there, in Node. What this suite covers is the surface: what is
 * served, what is proxied, and what was left exactly as it was.
 */

const UNDECLARED: SurfaceCatalog = parseSurfaces({});
const VALID_TOKEN = "scoped-bearer-abc123";

let outside: string;
let root: string;
let server: Server | undefined;
let upstream: Server | undefined;

beforeEach(() => {
	outside = mkdtempSync(path.join(tmpdir(), "refarm-web-attend-"));
	root = path.join(outside, "kit");
	mkdirSync(root, { recursive: true });
	// The static root as `refarm dist publish` leaves it: the cold-bootstrap kit. These two
	// names are what the operator's phone bootstraps from and what `farm-update` polls.
	writeFileSync(path.join(root, "install.mjs"), "// the bootstrap\n");
	writeFileSync(path.join(root, "manifest.json"), JSON.stringify({ files: [] }));
	writeFileSync(path.join(root, "index.html"), "<!doctype html><title>kit</title>");
});

afterEach(async () => {
	if (server) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	}
	if (upstream) {
		await new Promise<void>((resolve) => upstream?.close(() => resolve()));
		upstream = undefined;
	}
	rmSync(outside, { recursive: true, force: true });
});

async function serve(sidecarPort?: number): Promise<string> {
	const started = await startWebServeServer(root, {
		port: 0,
		host: "127.0.0.1",
		surfaces: UNDECLARED,
		// The SAS exchange is off: this suite is about the attend surface, and leaving the
		// exchange on would let it touch a policy path.
		sas: null,
		...(sidecarPort === undefined
			? {}
			: { sidecarTarget: { host: "127.0.0.1", port: sidecarPort } }),
	});
	server = started.server;
	return started.url;
}

/**
 * A stub of the sidecar's prompt routes, gated the way `auth.rs` gates them: a bearer on
 * every request, `GET /prompts` and `POST /prompts/:id/answer` reachable with a scoped
 * one, and the answer route settling exactly once so a second attempt gets `409` naming
 * the winner.
 */
async function startPromptStub(): Promise<number> {
	let settledBy: string | null = null;
	upstream = createHttpServer((req, res) => {
		req.resume();
		const authorization = req.headers.authorization;
		const json = (status: number, body: unknown) => {
			res.statusCode = status;
			res.setHeader("content-type", "application/json");
			res.end(JSON.stringify(body));
		};
		if (authorization !== `Bearer ${VALID_TOKEN}`) {
			return json(401, { error: "unauthorized" });
		}
		if (req.method === "GET" && req.url === "/prompts") {
			return json(200, {
				wire: "pending-prompt.v1",
				pollIntervalMs: 2_000,
				prompts: [
					{
						wire: "pending-prompt.v1",
						id: "p-1",
						prompt: { type: "confirm", question: "Apply?" },
						answerTravels: false,
						asker: { command: "refarm auth enrol", host: "tuono" },
						askedAt: 1_800_000_000_000,
						expiresAt: null,
					},
				],
			});
		}
		if (req.method === "POST" && req.url === "/prompts/p-1/answer") {
			if (settledBy !== null) {
				return json(409, { error: "already-settled", outcome: "answered", device: settledBy });
			}
			settledBy = "my-phone";
			return json(200, { outcome: "answered", device: "browser-surface" });
		}
		return json(404, { error: "not-found" });
	});
	await new Promise<void>((resolve) => upstream?.listen(0, "127.0.0.1", () => resolve()));
	return (upstream.address() as AddressInfo).port;
}

describe("the page lives on the listener, not in the cold-bootstrap kit", () => {
	it("serves `/attend` as a self-contained page", async () => {
		const url = await serve();
		const response = await fetch(`${url}${ATTEND_PAGE_PATH}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("cache-control")).toBe("no-store");
		const html = await response.text();

		// Nothing is fetched from anywhere else: no CDN, no font, no framework. Over a
		// tailnet on a phone there is no second chance to reach the internet.
		expect(html).not.toMatch(/https?:\/\/(?!localhost)/);
		expect(html).toContain('href="/attend/ds/tokens.css"');
		expect(html).toContain('href="/attend/ds/theme.css"');
		expect(html).toContain('href="/attend/ds/components.css"');
		// Every module import is one of this node's own compiled blocks.
		expect(html).toContain('from "/auth/sas/lib/index.js"');
		expect(html).toContain('from "/attend/lib/index.js"');
		expect(html).toContain('from "/attend/operations-lib/index.js"');
		expect(html).toContain('"@refarm.dev/localization-v1":"/attend/localization-lib/index.js"');
		expect(html).toContain('"@refarm.dev/ds/html":"/attend/ds-lib/html.js"');
		// It reimplements neither half.
		expect(html).toContain("startSasVerification");
		expect(html).toContain("createAttendClient");
		expect(html).toContain("createOperationClient");
	});

	it("serves the reusable operation and localization blocks beside the prompt block", async () => {
		const url = await serve();
		for (const route of [
			"/attend/operations-lib/index.js",
			"/attend/operations-lib/client.js",
			"/attend/operations-lib/messages.js",
			"/attend/operations-lib/wire.js",
			"/attend/localization-lib/index.js",
			"/attend/ds-lib/html.js",
		]) {
			const response = await fetch(`${url}${route}`);
			expect(response.status, `${route} must be served`).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/javascript");
		}
		for (const route of [
			"/attend/ds/tokens.css",
			"/attend/ds/theme.css",
			"/attend/ds/components.css",
		]) {
			const response = await fetch(`${url}${route}`);
			expect(response.status, `${route} must be served`).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/css");
		}
	});

	it("the operation block's browser graph uses only relative imports or declared import-map blocks", async () => {
		const url = await serve();
		const seen = new Set<string>();
		const queue = ["index.js"];
		const mapped = new Set(["@refarm.dev/localization-v1", "@refarm.dev/ds/html"]);
		while (queue.length > 0) {
			const name = queue.shift()!;
			if (seen.has(name)) continue;
			seen.add(name);
			const response = await fetch(`${url}/attend/operations-lib/${name}`);
			expect(response.status, `${name} must be served`).toBe(200);
			const source = await response.text();
			for (const match of source.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"([^"]+)"/gm)) {
				const specifier = match[1]!;
				if (specifier.startsWith("./")) queue.push(specifier.slice(2));
				else expect(mapped.has(specifier), `${name} imports unmapped ${specifier}`).toBe(true);
			}
		}
		expect(seen).toEqual(new Set(["index.js", "client.js", "messages.js", "render.js", "wire.js"]));
	});

	it("serves the attend block's compiled ESM, and only bare module filenames from it", async () => {
		const url = await serve();
		const module = await fetch(`${url}/attend/lib/index.js`);
		expect(module.status).toBe(200);
		expect(module.headers.get("content-type")).toContain("text/javascript");
		const source = await module.text();
		expect(source).toContain("export");

		for (const attempt of [
			"../package.json",
			"..%2Fpackage.json",
			"sub/dir.js",
			"index.ts",
			"wire.test.js",
		]) {
			expect((await fetch(`${url}/attend/lib/${attempt}`)).status).toBe(404);
		}
	});

	it("the WHOLE module graph the page loads resolves in a browser", async () => {
		const url = await serve();
		// Walked, not assumed: a single bare or `node:` specifier anywhere in the graph is
		// a blank screen on a phone with nothing but a console error to explain it, and it
		// would be introduced by an ordinary-looking import in a file nobody thought of as
		// browser code. So every module is fetched and every real import statement in it is
		// required to name a relative sibling.
		const seen = new Set<string>();
		const queue = ["index.js"];
		while (queue.length > 0) {
			const name = queue.shift()!;
			if (seen.has(name)) continue;
			seen.add(name);
			const response = await fetch(`${url}/attend/lib/${name}`);
			expect(response.status, `${name} must be served`).toBe(200);
			const source = await response.text();
			// Statement position only — the `node:readline` that `wire.ts` DISCUSSES lives in
			// a doc comment, and a naive substring search would fail on the explanation of
			// why the thing it warns about is not there.
			for (const match of source.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+"([^"]+)"/gm)) {
				const specifier = match[1]!;
				expect(specifier, `${name} imports ${specifier}`).toMatch(/^\.\/[a-z0-9-]+\.js$/);
				queue.push(specifier.slice(2));
			}
		}
		// The graph is the block, whole — not just its entry point.
		expect(seen.size).toBeGreaterThan(1);
	});

	it("leaves cold bootstrap exactly as it was", async () => {
		const url = await serve();
		// The two names the phone bootstraps from, at the paths they were already at.
		const install = await fetch(`${url}/install.mjs`);
		expect(install.status).toBe(200);
		expect(await install.text()).toBe("// the bootstrap\n");

		// `farm-update` polls the manifest and depends on its conditional-request policy.
		const manifest = await fetch(`${url}/manifest.json`);
		expect(manifest.status).toBe(200);
		const etag = manifest.headers.get("etag");
		expect(etag).toBeTruthy();
		const again = await fetch(`${url}/manifest.json`, { headers: { "if-none-match": etag! } });
		expect(again.status).toBe(304);

		// And the page did NOT become a file in the kit: nothing named `attend` is in the
		// root, so nothing entered the manifest and no `dist publish` is implied.
		expect((await fetch(`${url}/attend.html`)).status).toBe(404);
		expect((await fetch(`${url}/`)).status).toBe(200);
	});

	it("the page honours the wire version the node declares, from the block's own check", async () => {
		const url = await serve();
		const html = await (await fetch(`${url}${ATTEND_PAGE_PATH}`)).text();

		// A page cached in a browser is a frozen client, exactly as the kit on a phone is.
		// It must therefore READ the version the node declares rather than assume it — and
		// it must do so through the block, not through a copy of the rule written here.
		expect(html).toContain("refusalIsTerminal");
		expect(html).toContain("describeAttendWireNotice");
		// No version literal in the page: the constant lives in the block, and a second
		// copy here would be the next thing to drift.
		expect(html).not.toContain("pending-prompt.v");

		// And the block it imports really exports them — followed through the module
		// GRAPH, not asserted against a bundle. `tsc` emits one file per source file, so
		// `index.js` carries only re-export lines and the symbols live in their own
		// modules; a browser resolves that fine. Asserting the symbol inside `index.js`
		// asserted a bundled shape this build never produces, which is why it failed while
		// the page itself was correct.
		const entry = await (await fetch(`${url}/attend/lib/index.js`)).text();
		const reexported = [...entry.matchAll(/from\s+"\.\/([\w.-]+\.js)"/g)].map((m) => m[1]);
		expect(reexported.length).toBeGreaterThan(0);

		const graph = await Promise.all(
			reexported.map(async (file) => {
				const response = await fetch(`${url}/attend/lib/${file}`);
				expect(response.status).toBe(200);
				return response.text();
			}),
		);
		const served = [entry, ...graph].join("\n");
		for (const symbol of ["refusalIsTerminal", "describeAttendWireNotice", "checkAttendListWire"]) {
			expect(served).toContain(symbol);
		}
	});

	it("does not shadow a static file that happens to be called something else", async () => {
		writeFileSync(path.join(root, "attendance.txt"), "not the page");
		const url = await serve();
		const response = await fetch(`${url}/attendance.txt`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("not the page");
	});
});

describe("`/prompts` reaches the daemon through this listener", () => {
	it("is recognised as a sidecar API path, as a whole segment only", () => {
		expect(isSidecarApiPath("/prompts")).toBe(true);
		expect(isSidecarApiPath("/prompts/p-1/answer")).toBe(true);
		// A prefix must be a whole segment: the page must not accidentally proxy a static
		// asset whose name merely starts the same way.
		expect(isSidecarApiPath("/promptsxyz")).toBe(false);
		expect(isSidecarApiPath("/attend")).toBe(false);
		expect(isSidecarApiPath("/attend/lib/index.js")).toBe(false);
	});

	it("forwards the credential, so the upstream gate is still the only thing deciding", async () => {
		const url = await serve(await startPromptStub());

		// No credential ⇒ the upstream refuses. The proxy grants nothing.
		expect((await fetch(`${url}/prompts`)).status).toBe(401);

		// Wrong credential ⇒ still refused.
		const wrong = await fetch(`${url}/prompts`, { headers: { authorization: "Bearer nope" } });
		expect(wrong.status).toBe(401);

		// The scoped credential ⇒ through, with the prompts and the advertised cadence.
		const ok = await fetch(`${url}/prompts`, {
			headers: { authorization: `Bearer ${VALID_TOKEN}` },
		});
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as { pollIntervalMs: number; prompts: unknown[] };
		expect(body.pollIntervalMs).toBe(2_000);
		expect(body.prompts).toHaveLength(1);
	});

	it("first-answer-wins survives the proxy: 200 then 409 naming the winner", async () => {
		const url = await serve(await startPromptStub());
		const answer = () =>
			fetch(`${url}/prompts/p-1/answer`, {
				method: "POST",
				headers: { authorization: `Bearer ${VALID_TOKEN}`, "content-type": "application/json" },
				body: JSON.stringify({ value: true }),
			});

		const first = await answer();
		expect(first.status).toBe(200);

		const second = await answer();
		expect(second.status).toBe(409);
		// The device the loser is told about must survive the proxy verbatim — a 409 that
		// arrived without it would leave the page unable to say who answered (P2).
		expect(await second.json()).toMatchObject({ device: "my-phone", outcome: "answered" });
	});

	it("an unreachable daemon is a 502 — never a 200, and never a 401", async () => {
		// Nothing listening on the sidecar target at all. The page must be able to tell
		// this apart from a refused credential, which it can only do if the status differs.
		const dead = createHttpServer(() => {});
		await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", () => resolve()));
		const deadPort = (dead.address() as AddressInfo).port;
		await new Promise<void>((resolve) => dead.close(() => resolve()));

		const url = await serve(deadPort);
		const response = await fetch(`${url}/prompts`, {
			headers: { authorization: `Bearer ${VALID_TOKEN}` },
		});
		expect(response.status).toBe(502);
	});
});
