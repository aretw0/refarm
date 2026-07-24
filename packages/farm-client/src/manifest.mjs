/**
 * manifest — the neutral wire contract for mesh artifact distribution.
 *
 * The dev PC serves a BUILT payload (the farm-client kit today, a compiled
 * tractor binary for an x86 tailnet peer tomorrow) plus a manifest; a device
 * downloads, verifies, and updates over the mesh — no git, no GitHub release.
 * These helpers are PURE (no I/O): `farm-update` is the thin I/O shell around
 * them, so the contract can be tested in isolation and reused by any surface.
 *
 * Integrity is SRI-style `sha256-<base64>` — the same format refarm already
 * uses for plugin integrity, so one convention spans plugins and kit files.
 */

import { createHash } from "node:crypto";

/** SRI-style integrity of bytes (Buffer/Uint8Array/string): "sha256-<base64>". */
export function integrityOf(bytes) {
	return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

/**
 * A manifest file path must be relative and stay inside the kit dir. Reject
 * absolutes and any "." / ".." / empty segment, so a hostile manifest can never
 * make a device write outside its kit directory.
 */
export function isSafeRelPath(p) {
	if (typeof p !== "string" || p.length === 0) return false;
	if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
	return !p.split(/[\\/]/).some((seg) => seg === "" || seg === "." || seg === "..");
}

/** Validate + normalize a manifest (tolerant of a JSON string). Throws on a
 * malformed shape or any unsafe file path — the contract boundary is the guard. */
export function parseManifest(input) {
	const m = typeof input === "string" ? JSON.parse(input) : input;
	if (!m || typeof m !== "object") throw new Error("manifest: not an object");
	if (typeof m.name !== "string" || !m.name) throw new Error("manifest: missing name");
	if (typeof m.version !== "string" || !m.version) throw new Error("manifest: missing version");
	const files = (Array.isArray(m.files) ? m.files : []).map((f) => {
		if (!f || typeof f.path !== "string" || typeof f.integrity !== "string") {
			throw new Error("manifest: each file needs path + integrity");
		}
		if (!isSafeRelPath(f.path)) throw new Error(`manifest: unsafe file path ${JSON.stringify(f.path)}`);
		return { path: f.path, integrity: f.integrity, bytes: Number.isFinite(f.bytes) ? f.bytes : 0 };
	});
	return {
		name: m.name,
		version: m.version,
		platform: typeof m.platform === "string" ? m.platform : null,
		createdAt: typeof m.createdAt === "string" ? m.createdAt : null,
		files,
	};
}

/**
 * What a device must download to match `remote`, given its currently-installed
 * `local` manifest (or null when nothing is installed). A file is stale when its
 * integrity differs or it is absent locally. PURE — no I/O.
 */
export function planUpdate(remote, local) {
	const target = parseManifest(remote);
	const installed = local == null ? null : parseManifest(local);
	const have = new Map((installed?.files ?? []).map((f) => [f.path, f.integrity]));
	const toDownload = target.files.filter((f) => have.get(f.path) !== f.integrity);
	return {
		name: target.name,
		fromVersion: installed?.version ?? null,
		toVersion: target.version,
		toDownload,
		totalBytes: toDownload.reduce((sum, f) => sum + (f.bytes || 0), 0),
		upToDate: toDownload.length === 0,
	};
}

/** Build a manifest object from hashed files. PURE (createdAt injected). */
export function buildManifest({ name, version, platform = null, createdAt, files }) {
	return {
		name,
		version,
		platform,
		createdAt,
		files: files.map((f) => ({ path: f.path, integrity: f.integrity, bytes: f.bytes })),
	};
}
