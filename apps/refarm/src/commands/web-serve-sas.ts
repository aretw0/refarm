import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

import {
	createSasRateLimiter,
	handleSasHttp,
	SAS_HTTP_BASE,
	SAS_POLL_INTERVAL_MS,
	type SasExchangeStore,
} from "@refarm.dev/emoji-sas-v1";

import { createFilesystemSasExchangeStore, resolveAuthPolicyPath, resolveSasDir } from "./sas-store.js";

/**
 * The emoji-SAS exchange, mounted on `refarm web serve`.
 *
 * ── WHY HERE AND NOT ON THE RUST SIDECAR ─────────────────────────────────────────
 *
 * Four things line up, and all four were checked against the code rather than assumed:
 *
 *  1. The browser already talks to this listener. It IS the node's web surface.
 *  2. `web` is declared `gate: "none"` — deliberately open for cold bootstrap — and an
 *     SAS start endpoint MUST be reachable by a party with no credential. That is
 *     exactly E2's admissible shape: open, bounded, granting nothing until confirmed.
 *  3. The auth policy is WRITTEN by TypeScript and READ by Rust, and the daemon
 *     hot-reloads it on a two-second poll (`AuthGate::reload_if_changed`). A credential
 *     issued from here therefore takes effect with no restart and no Rust change.
 *  4. `packages/tractor/**` is a protected surface, and nothing in this flow needs it.
 *
 * ── WHAT THIS DOES *NOT* CHANGE, WHICH MATTERS ───────────────────────────────────
 *
 * `surfaceEnforceableGate("web")` stays `null`, and `web` still cannot declare
 * `"gate": "device-token"`. Mounting these routes does not make this listener a gated
 * one: the exchange is deliberately ungated (that is the point), and the static payload
 * is unchanged. S3 of the surfaces design — "a surface may not declare a gate it cannot
 * enforce" — is untouched, so `packages/std/src/surfaces.ts` and its Rust twin in
 * `packages/tractor/**` need no edit. If a later slice makes this listener verify a
 * credential on ALL of its routes, that is when both halves of that table change,
 * together, and not before.
 *
 * ── THE THREE ROUTES ─────────────────────────────────────────────────────────────
 *
 *  - `POST /auth/sas/start` and `GET /auth/sas/<id>` — the exchange itself, whose
 *    semantics live in the block (`handleSasHttp`), not here.
 *  - `GET /auth/sas/lib/*.js` — the block's own compiled modules, served to the page.
 *    The browser runs the SAME code the node runs; a page that reimplemented the
 *    transcript encoding is how two sides come to disagree about what they compare.
 *  - `GET /auth/verify` — a self-contained page that starts an exchange and renders the
 *    seven emoji.
 */

/** Where the page lives. Deliberately NOT under `/auth/sas`, which the block owns. */
export const SAS_PAGE_PATH = "/auth/verify";
const LIB_PREFIX = `${SAS_HTTP_BASE}/lib/`;

export interface SasVerificationSurface {
	/** Handle the request if it belongs to this surface. Returns whether it did. */
	handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
}

export interface SasVerificationSurfaceOptions {
	/** Sovereign root, for deriving the auth policy path. Defaults to cwd. */
	configRoot?: string;
	/** Injected by tests; production derives it from the policy path. */
	store?: SasExchangeStore;
	/** Injected by tests, so a bounds assertion does not depend on wall-clock. */
	now?: () => number;
	env?: NodeJS.ProcessEnv;
}

/** Read a JSON body, bounded. A start body is a public key and two short strings; a
 *  megabyte of it is not a mistake, so the cap is small and the refusal explicit. */
const MAX_BODY_BYTES = 8 * 1024;

async function readJsonBody(req: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false }> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > MAX_BODY_BYTES) return { ok: false };
		chunks.push(buffer);
	}
	if (size === 0) return { ok: true, value: {} };
	try {
		return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
	} catch {
		return { ok: false };
	}
}

function sendJson(res: ServerResponse, status: number, body: unknown, retryAfterSeconds?: number): void {
	const text = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(text));
	// Nothing about a verification may be cached, by anyone, ever.
	res.setHeader("Cache-Control", "no-store");
	if (retryAfterSeconds !== undefined) res.setHeader("Retry-After", String(retryAfterSeconds));
	res.end(text);
}

/**
 * Where the block's compiled ESM lives, so the page can import it.
 *
 * Resolved through the package's own `package.json` — never a path assembled out of
 * `node_modules` by hand, which breaks the moment the workspace is laid out differently
 * or resolution is toggled (`reso src` / `reso dist`).
 *
 * Via `package.json` rather than the `.` entry point, deliberately: the block is
 * ESM-only, so its `exports` map has an `import` condition and no `require` one, and
 * `createRequire().resolve("@refarm.dev/emoji-sas-v1")` therefore fails outright with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. Resolving the manifest and joining `dist` gets the
 * same answer without asking a CommonJS resolver to honour an ESM-only entry.
 */
function resolveBlockDistDir(): string | null {
	try {
		const require = createRequire(import.meta.url);
		const manifest = require.resolve("@refarm.dev/emoji-sas-v1/package.json");
		return path.join(path.dirname(manifest), "dist");
	} catch {
		return null;
	}
}

/** The page. Self-contained, no build step, no framework, no external fetch — it
 *  imports the block's own modules and nothing else. */
function verificationPage(): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verify this surface — refarm</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; display: grid; place-items: center; min-height: 100vh; padding: 1.5rem; }
  main { max-width: 34rem; width: 100%; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  p { margin: .5rem 0; line-height: 1.5; }
  .row { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1.5rem 0; }
  .cell { text-align: center; min-width: 4.5rem; }
  .glyph { font-size: 2.5rem; line-height: 1.1; }
  .name { font-size: .8rem; opacity: .75; }
  .state { padding: .75rem 1rem; border-radius: .5rem; border: 1px solid currentColor; }
  .ok { color: #1a7f37; }
  .bad { color: #b3261e; }
  code { font-size: .85rem; word-break: break-all; }
</style>
</head>
<body>
<main>
  <h1>Verify this surface</h1>
  <p>This page has no credential. It is asking the node to vouch for it.</p>
  <p>Compare the seven below with the ones shown by
     <code>refarm auth verify</code> at the node, <strong>in the same order</strong>.
     If they differ in any way, answer <strong>no</strong> there.</p>
  <div class="row" id="row"></div>
  <div class="state" id="state">Starting…</div>
</main>
<script type="module">
import { startSasVerification } from "${LIB_PREFIX}index.js";

const row = document.getElementById("row");
const state = document.getElementById("state");

function say(text, kind) {
  state.textContent = text;
  state.className = "state" + (kind ? " " + kind : "");
}

try {
  const handle = await startSasVerification({
    client: navigator.userAgent.slice(0, 100),
  });
  row.replaceChildren();
  for (const emoji of handle.emoji) {
    const cell = document.createElement("div");
    cell.className = "cell";
    const glyph = document.createElement("div");
    glyph.className = "glyph";
    glyph.textContent = emoji.emoji;
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = emoji.description;
    cell.append(glyph, name);
    row.append(cell);
  }
  say("Waiting for the node… run \`refarm auth verify\` there.");
  const outcome = await handle.await();
  if (outcome.state === "granted") {
    // The token is held in memory for this page only. It is deliberately NOT written
    // to localStorage: a secret readable by any script on this origin is the exposure
    // this whole exchange exists to avoid.
    globalThis.__refarmScopedToken = outcome.token;
    say("Verified. This page holds a scoped credential (" + outcome.scope.join(", ") + ") in memory only.", "ok");
  } else {
    say("Aborted: " + outcome.detail, "bad");
  }
} catch (error) {
  say(String(error && error.message ? error.message : error), "bad");
}
</script>
</body>
</html>
`;
}

export function createSasVerificationSurface(
	options: SasVerificationSurfaceOptions = {},
): SasVerificationSurface {
	const policyPath = resolveAuthPolicyPath({
		...(options.configRoot === undefined ? {} : { root: options.configRoot }),
		...(options.env === undefined ? {} : { env: options.env }),
	});
	const store = options.store ?? createFilesystemSasExchangeStore(resolveSasDir(policyPath));
	// ONE limiter for the process, so the bound is a bound rather than a per-request
	// object that resets itself.
	const limiter = createSasRateLimiter();
	const distDir = resolveBlockDistDir();
	const page = verificationPage();

	return {
		async handle(req, res, pathname): Promise<boolean> {
			if (pathname === SAS_PAGE_PATH) {
				res.statusCode = 200;
				res.setHeader("Content-Type", "text/html; charset=utf-8");
				res.setHeader("Cache-Control", "no-store");
				res.end(req.method === "HEAD" ? undefined : page);
				return true;
			}

			if (pathname.startsWith(LIB_PREFIX)) {
				const name = pathname.slice(LIB_PREFIX.length);
				// Basename only, `.js` only, from one directory. There is no traversal to
				// contain because nothing that is not a bare module filename is served.
				if (!distDir || !/^[a-z0-9-]+\.js$/.test(name)) {
					sendJson(res, 404, { error: "not-found" });
					return true;
				}
				try {
					const bytes = await readFile(path.join(distDir, name));
					res.statusCode = 200;
					res.setHeader("Content-Type", "text/javascript; charset=utf-8");
					res.setHeader("Content-Length", bytes.length);
					res.end(req.method === "HEAD" ? undefined : bytes);
				} catch {
					sendJson(res, 404, { error: "not-found" });
				}
				return true;
			}

			if (!pathname.startsWith(`${SAS_HTTP_BASE}/`) && pathname !== SAS_HTTP_BASE) return false;

			let body: unknown = {};
			if (req.method === "POST") {
				const parsed = await readJsonBody(req);
				if (!parsed.ok) {
					sendJson(res, 400, {
						error: "invalid-body",
						detail: `expected a JSON object of at most ${MAX_BODY_BYTES} bytes`,
					});
					return true;
				}
				body = parsed.value;
			}

			const response = await handleSasHttp(
				{
					store,
					limiter,
					surface: "web",
					...(options.now ? { now: options.now } : {}),
				},
				{ method: req.method ?? "GET", path: pathname, body },
			);
			if (!response) return false;
			sendJson(res, response.status, response.body, response.retryAfterSeconds);
			return true;
		},
	};
}

/** Re-exported so the command's help text and the tests can state the interval this
 *  surface tells callers to poll at without importing the block twice. */
export { SAS_POLL_INTERVAL_MS };
