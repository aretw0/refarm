import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Serving a zero-dependency block's own compiled ESM to a page on this listener.
 *
 * Two surfaces do this now — the emoji-SAS exchange and the attend page — for the same
 * reason, so the reasoning lives in one place rather than being restated (and drifting)
 * beside each of them.
 *
 * ── WHY THE PAGE IMPORTS THE BLOCK AT ALL ─────────────────────────────────────────
 *
 * The browser runs the SAME code the node runs. A page that reimplemented the transcript
 * encoding, or the reading of a pending prompt, is how two sides come to disagree about
 * what they are looking at — and for the SAS exchange that disagreement would be
 * indistinguishable from an attack: two emoji rows that differ, forever, for no reason.
 *
 * ── HOW THE DIRECTORY IS FOUND ────────────────────────────────────────────────────
 *
 * Through the package's own `package.json`, never a path assembled out of `node_modules`
 * by hand — that breaks the moment the workspace is laid out differently or resolution is
 * toggled (`reso src` / `reso dist`).
 *
 * Via the manifest rather than the `.` entry point, deliberately: these blocks are
 * ESM-only, so their `exports` map has an `import` condition and no `require` one, and
 * `createRequire().resolve("@refarm.dev/<block>")` therefore fails outright with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. Resolving the manifest and joining `dist` gets the
 * same answer without asking a CommonJS resolver to honour an ESM-only entry.
 */

/** The block's `dist` directory, or null when it cannot be resolved (an unbuilt
 *  workspace). A missing directory must produce a 404, never a crash on boot. */
export function resolveBlockDistDir(packageName: string): string | null {
	try {
		const require = createRequire(import.meta.url);
		const manifest = require.resolve(`${packageName}/package.json`);
		return path.join(path.dirname(manifest), "dist");
	} catch {
		try {
			// Packages need not expose package.json. Their import entry is already in dist,
			// and ESM resolution is the authoritative way to find an ESM-only block.
			return path.dirname(fileURLToPath(import.meta.resolve(packageName)));
		} catch {
			return null;
		}
	}
}

/** Resolve one package export (for example DS CSS) without assuming workspace layout. */
export function resolvePackageAsset(packageName: string, subpath: string): string | null {
	try {
		return createRequire(import.meta.url).resolve(`${packageName}/${subpath}`);
	} catch {
		return null;
	}
}

/**
 * Names this will serve out of a block's `dist`: a BARE module filename and nothing else.
 *
 * There is no traversal to contain because nothing that is not this shape is served —
 * not `../package.json`, not a percent-encoded variant of it, not a subdirectory, not a
 * `.ts` source, and not a `.test.js` (which carries a dot before the extension and so
 * cannot match).
 */
export const BLOCK_MODULE_NAME = /^[a-z0-9-]+\.js$/;

function notFound(res: ServerResponse): void {
	const text = JSON.stringify({ error: "not-found" });
	res.statusCode = 404;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(text));
	res.end(text);
}

/** Serve one module from `distDir`. Always answers — the caller has already decided this
 *  path belongs to it. */
export async function serveBlockModule(
	distDir: string | null,
	name: string,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	if (!distDir || !BLOCK_MODULE_NAME.test(name)) {
		notFound(res);
		return;
	}
	try {
		const bytes = await readFile(path.join(distDir, name));
		res.statusCode = 200;
		res.setHeader("Content-Type", "text/javascript; charset=utf-8");
		res.setHeader("Content-Length", bytes.length);
		res.end(req.method === "HEAD" ? undefined : bytes);
	} catch {
		notFound(res);
	}
}

/** Serve one already-resolved package asset. Caller input never enters its path. */
export async function servePackageAsset(
	filePath: string | null,
	contentType: string,
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	if (!filePath) return notFound(res);
	try {
		const bytes = await readFile(filePath);
		res.statusCode = 200;
		res.setHeader("Content-Type", contentType);
		res.setHeader("Content-Length", bytes.length);
		res.end(req.method === "HEAD" ? undefined : bytes);
	} catch {
		notFound(res);
	}
}
