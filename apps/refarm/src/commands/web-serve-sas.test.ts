import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import {
	createInMemorySasExchangeStore,
	SAS_MAX_PENDING,
	SAS_START_LIMIT,
	startSasVerification,
	type SasExchangeStore,
} from "@refarm.dev/emoji-sas-v1";
import { parseSurfaces, type SurfaceCatalog } from "@refarm.dev/std";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSasVerificationSurface, SAS_PAGE_PATH } from "./web-serve-sas.js";
import { startWebServeServer } from "./web-serve.js";

/**
 * The exchange, mounted on the real `refarm web serve` listener.
 *
 * Every test injects an IN-MEMORY store. Nothing here can reach the operator's
 * `.refarm/auth-policy.json` or create a `sas/` directory beside it: the only path this
 * suite resolves is a temp root it made itself.
 */

const UNDECLARED: SurfaceCatalog = parseSurfaces({});

let root: string;
let outside: string;
let server: Server | undefined;
let store: SasExchangeStore;
let clock: { now: number };

beforeEach(() => {
	outside = mkdtempSync(path.join(tmpdir(), "refarm-web-sas-"));
	root = path.join(outside, "site");
	mkdirSync(root, { recursive: true });
	writeFileSync(path.join(root, "index.html"), "<!doctype html><title>hub</title>");
	store = createInMemorySasExchangeStore();
	clock = { now: 1_800_000_000_000 };
});

afterEach(async () => {
	if (server) {
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		server = undefined;
	}
	rmSync(outside, { recursive: true, force: true });
});

async function serve(): Promise<string> {
	const started = await startWebServeServer(root, {
		port: 0,
		host: "127.0.0.1",
		surfaces: UNDECLARED,
		sas: createSasVerificationSurface({ store, now: () => clock.now }),
	});
	server = started.server;
	return started.url;
}

describe("the emoji-SAS exchange on `refarm web serve`", () => {
	it("serves a self-contained page that imports the block's own modules", async () => {
		const url = await serve();
		const response = await fetch(`${url}${SAS_PAGE_PATH}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("cache-control")).toBe("no-store");
		const html = await response.text();
		// The page must not reimplement the transcript encoding — it imports the same
		// module the node derives from. A second implementation is how two sides come to
		// disagree about what they are comparing.
		expect(html).toContain('from "/auth/sas/lib/index.js"');
		expect(html).toContain("startSasVerification");
		// And it must not park the credential anywhere a later script on this origin can
		// read it. `localStorage` is NAMED in a comment (saying why it is not used), so
		// the assertion is about writes, not about the word.
		expect(html).not.toMatch(/localStorage\s*\.|sessionStorage\s*\.|document\s*\.\s*cookie/);
		expect(html).toContain("in memory only");
		// Nothing is fetched from anywhere else.
		expect(html).not.toMatch(/https?:\/\/(?!localhost)/);
	});

	it("serves the block's compiled ESM, and only bare module filenames from it", async () => {
		const url = await serve();
		const module = await fetch(`${url}/auth/sas/lib/index.js`);
		expect(module.status).toBe(200);
		expect(module.headers.get("content-type")).toContain("text/javascript");
		expect(await module.text()).toContain("export");

		for (const attempt of ["../package.json", "..%2Fpackage.json", "sub/dir.js", "index.ts"]) {
			const refused = await fetch(`${url}/auth/sas/lib/${attempt}`);
			expect(refused.status).toBe(404);
		}
	});

	it("starts an exchange for a caller with NO credential, and grants nothing", async () => {
		const url = await serve();
		const started = await fetch(`${url}/auth/sas/start`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ publicKey: (await freshPublicKey()) }),
		});
		expect(started.status).toBe(201);
		const body = (await started.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(typeof body.confirmerPublicKey).toBe("string");
		expect(body.pollIntervalMs).toBe(2_000);

		// Nothing readable back before confirmation.
		const polled = await fetch(`${url}/auth/sas/${body.id as string}`);
		expect(await polled.json()).toEqual({
			wire: "emoji-sas.v1",
			ok: true,
			state: "pending",
			pollIntervalMs: 2_000,
		});
		// And no listing.
		expect((await fetch(`${url}/auth/sas`)).status).toBe(404);
	});

	it("the browser half runs unchanged against the real listener", async () => {
		const url = await serve();
		const handle = await startSasVerification({ baseUrl: url, client: "a test browser" });
		expect(handle.emoji).toHaveLength(7);
		// The row the browser derived is the row the node holds for that exchange.
		const { emojiForExchange } = await import("./auth-verify.js");
		const onNode = await emojiForExchange((await store.get(handle.id))!);
		expect(onNode.map((e) => e.index)).toEqual(handle.emoji.map((e) => e.index));
		expect(await handle.poll()).toBeNull();
	});

	it("bounds hold over the socket: the pending ceiling refuses with a reason", async () => {
		const url = await serve();
		for (let i = 0; i < SAS_MAX_PENDING; i += 1) {
			expect((await startRaw(url)).status).toBe(201);
		}
		const refused = await startRaw(url);
		expect(refused.status).toBe(503);
		expect(((await refused.json()) as { error: string }).error).toBe("too-many-pending");
	});

	it("bounds hold over the socket: the rate limit answers 429 with Retry-After", async () => {
		const url = await serve();
		// Settle each one immediately so the PENDING ceiling is not what refuses — this
		// test is about the rate limit specifically.
		let refused: Response | undefined;
		for (let i = 0; i < SAS_START_LIMIT + 1; i += 1) {
			const response = await startRaw(url);
			if (response.status === 429) {
				refused = response;
				break;
			}
			const id = ((await response.json()) as { id: string }).id;
			await store.settle(id, { state: "aborted", at: clock.now, abortReason: "cancelled" });
		}
		expect(refused).toBeTruthy();
		expect(refused!.headers.get("retry-after")).toBeTruthy();
		expect(((await refused!.json()) as { error: string }).error).toBe("rate-limited");
	});

	it("refuses an oversized or unparseable body", async () => {
		const url = await serve();
		const huge = await fetch(`${url}/auth/sas/start`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ publicKey: "x".repeat(20_000) }),
		});
		expect(huge.status).toBe(400);
		expect(((await huge.json()) as { error: string }).error).toBe("invalid-body");

		const garbage = await fetch(`${url}/auth/sas/start`, { method: "POST", body: "{" });
		expect(garbage.status).toBe(400);
	});

	it("leaves the static server exactly as it was", async () => {
		const url = await serve();
		const index = await fetch(`${url}/`);
		expect(index.status).toBe(200);
		expect(index.headers.get("cross-origin-opener-policy")).toBe("same-origin");
		expect(await index.text()).toContain("hub");
		expect((await fetch(`${url}/nope.html`)).status).toBe(404);
	});

	it("can be switched off entirely, leaving a listener that serves only files", async () => {
		const started = await startWebServeServer(root, {
			port: 0,
			host: "127.0.0.1",
			surfaces: UNDECLARED,
			sas: null,
		});
		server = started.server;
		// With no exchange mounted, the path falls through to the static root and 404s.
		expect((await fetch(`${started.url}${SAS_PAGE_PATH}`)).status).toBe(404);
		expect((await fetch(`${started.url}/auth/sas/start`, { method: "POST" })).status).toBe(405);
	});
});

async function freshPublicKey(): Promise<string> {
	const { generateSasKeyPair } = await import("@refarm.dev/emoji-sas-v1");
	return (await generateSasKeyPair()).publicKey;
}

async function startRaw(url: string): Promise<Response> {
	return fetch(`${url}/auth/sas/start`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ publicKey: await freshPublicKey() }),
	});
}
