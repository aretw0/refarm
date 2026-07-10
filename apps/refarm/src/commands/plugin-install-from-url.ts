import { createFsAssetStore } from "@refarm.dev/asset-resolver-contract-v1/node";
import { isSha256Hex, verifyContentHash } from "@refarm.dev/asset-resolver-contract-v1";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import { scopedAssetsDir } from "@refarm.dev/storage-node-view";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { pluginIdToFsToken, pluginsBaseDir, sentinelPath } from "./plugin-shared.js";

/**
 * Install a plugin from a `url` reference (ADR-086 Fase 7) — the REMOTE sibling of
 * the local `buildExtensionInstallReport`. A `url` ref points at a plugin DESCRIPTOR
 * (a `plugin.json`-shaped JSON) that declares the plugin's id, its `entry` (the
 * `.wasm` URL), and its `integrity` (`sha256-<hash>`). The install fetches the
 * descriptor, fetches the wasm, and — crucially — VERIFIES the wasm bytes against
 * the declared integrity BEFORE trusting them (the content-addressed hash gate,
 * shared with the asset resolver). Only then does it content-store the bytes and
 * write the local manifest.
 *
 * SAFETY — the integrity is a content-address, verified before the bytes are ever
 * stored or loaded. Fetching from an untrusted URL is safe by construction: bytes
 * whose hash does not match the declared integrity are REJECTED, never installed.
 * This is the same gate `verifyContentHash` enforces for the p2p resolver, applied
 * at the install boundary. There is no execution here — only fetch + verify + store.
 */

/** The fetch surface this installer needs — injected so tests supply a stub and no
 * network is touched. Defaults to the platform `fetch`. */
export type UrlFetch = (
	url: string,
	init?: { signal?: AbortSignal },
) => Promise<{
	ok: boolean;
	status: number;
	statusText: string;
	json(): Promise<unknown>;
	arrayBuffer(): Promise<ArrayBuffer>;
}>;

export interface UrlInstallInput {
	/** The descriptor URL (an `https://…` reference — its shape selected `url`). */
	url: string;
	/** Injected fetch (default: global fetch). */
	fetchImpl?: UrlFetch;
	/** Per-request timeout in ms (default 15s), mirroring the config remote loader. */
	timeoutMs?: number;
}

export type UrlInstallReport = JsonSuccessEnvelope<{
	pluginId: string;
	installedFrom: string;
	installedTo: string;
	integrity: string;
	bytes: number;
}>;

/** The minimal descriptor a `url` install consumes. Extra fields are preserved
 * into the written manifest (the descriptor IS the manifest template, minus the
 * entry/integrity rewrite to the local content-store). */
interface UrlPluginDescriptor {
	id: string;
	entry: string;
	integrity: string;
	version?: string;
	[key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the fetched descriptor has the id/entry/integrity a url install needs.
 * Returns the typed descriptor or a message describing the first defect. */
function parseDescriptor(
	value: unknown,
): { ok: true; descriptor: UrlPluginDescriptor } | { ok: false; message: string } {
	if (!isRecord(value)) {
		return { ok: false, message: "descriptor is not a JSON object" };
	}
	const { id, entry, integrity } = value;
	if (typeof id !== "string" || id.length === 0) {
		return { ok: false, message: "descriptor is missing a string 'id'" };
	}
	if (typeof entry !== "string" || entry.length === 0) {
		return { ok: false, message: "descriptor is missing a string 'entry' (the .wasm URL)" };
	}
	if (typeof integrity !== "string" || integrity.length === 0) {
		return {
			ok: false,
			message: "descriptor is missing a string 'integrity' (sha256-<hash>)",
		};
	}
	return { ok: true, descriptor: value as UrlPluginDescriptor };
}

/** Extract the lowercase hex sha-256 from an `sha256-<hex>` / `sha256:<hex>`
 * integrity string, or null if it is not a well-formed sha-256 integrity. */
function integrityHex(integrity: string): string | null {
	const hex = integrity.replace(/^sha256[-:]/i, "").toLowerCase();
	return isSha256Hex(hex) ? hex : null;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function buildUrlInstallReport(
	input: UrlInstallInput,
): Promise<UrlInstallReport | ReturnType<typeof buildJsonErrorEnvelope>> {
	const fetchImpl = input.fetchImpl ?? (globalThis.fetch as unknown as UrlFetch);
	if (typeof fetchImpl !== "function") {
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "url_fetch_unavailable",
			message: "No fetch implementation is available to install from a URL.",
			nextAction: "Run on a runtime with global fetch, or install from a local path.",
		});
	}
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	// 1) Fetch the descriptor JSON.
	let descriptorValue: unknown;
	try {
		const res = await fetchImpl(input.url, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) {
			return buildJsonErrorEnvelope({
				command: "plugin",
				operation: "install",
				error: "url_descriptor_fetch_failed",
				message: `Fetching the plugin descriptor failed: ${res.status} ${res.statusText} (${input.url}).`,
				nextAction: "Check the URL points at a reachable plugin descriptor.",
				extra: { url: input.url, status: res.status },
			});
		}
		descriptorValue = await res.json();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "url_descriptor_unreachable",
			message: `Could not fetch the plugin descriptor from ${input.url}: ${message}`,
			nextAction: "Check the URL and your network, then retry.",
			extra: { url: input.url },
		});
	}

	// 2) Validate the descriptor shape.
	const parsed = parseDescriptor(descriptorValue);
	if (!parsed.ok) {
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "url_descriptor_invalid",
			message: `The plugin descriptor at ${input.url} is invalid: ${parsed.message}.`,
			nextAction: "The URL must serve a plugin.json with id, entry and integrity.",
			extra: { url: input.url },
		});
	}
	const { descriptor } = parsed;

	// 3) The declared integrity is a content-address; a malformed one is fatal
	//    BEFORE any wasm fetch — there would be nothing to verify against.
	const declaredHex = integrityHex(descriptor.integrity);
	if (!declaredHex) {
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "url_integrity_malformed",
			message: `The descriptor's integrity ("${descriptor.integrity}") is not a sha256-<hash>.`,
			nextAction: "Fix the descriptor to declare a sha256 integrity.",
			extra: { url: input.url, pluginId: descriptor.id },
		});
	}

	// 4) Resolve the wasm entry URL (absolute, or relative to the descriptor URL).
	let wasmUrl: string;
	try {
		wasmUrl = new URL(descriptor.entry, input.url).toString();
	} catch {
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "url_entry_invalid",
			message: `The descriptor's entry ("${descriptor.entry}") is not a valid URL.`,
			nextAction: "The entry must be an absolute URL or one relative to the descriptor.",
			extra: { url: input.url, pluginId: descriptor.id },
		});
	}

	// 5) Fetch the wasm bytes.
	let wasmBytes: Uint8Array;
	try {
		const res = await fetchImpl(wasmUrl, { signal: AbortSignal.timeout(timeoutMs) });
		if (!res.ok) {
			return buildJsonErrorEnvelope({
				command: "plugin",
				operation: "install",
				error: "url_wasm_fetch_failed",
				message: `Fetching the plugin wasm failed: ${res.status} ${res.statusText} (${wasmUrl}).`,
				nextAction: "Check the descriptor's entry URL is reachable.",
				extra: { url: input.url, wasmUrl, status: res.status, pluginId: descriptor.id },
			});
		}
		wasmBytes = new Uint8Array(await res.arrayBuffer());
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "url_wasm_unreachable",
			message: `Could not fetch the plugin wasm from ${wasmUrl}: ${message}`,
			nextAction: "Check the entry URL and your network, then retry.",
			extra: { url: input.url, wasmUrl, pluginId: descriptor.id },
		});
	}

	// 6) THE GATE: verify the fetched bytes against the declared integrity BEFORE
	//    they are stored or trusted. Bytes from an untrusted URL that do not hash
	//    to the declared content-address are rejected — never installed.
	const verified = await verifyContentHash(
		wasmBytes,
		{ hash: declaredHex, alg: "sha-256" },
		(bytes) => createHash("sha256").update(bytes).digest("hex"),
	);
	if (!verified) {
		const actual = createHash("sha256").update(wasmBytes).digest("hex");
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "url_integrity_mismatch",
			message: `The fetched wasm for ${descriptor.id} does not match the declared integrity (declared ${descriptor.integrity}, actual sha256-${actual}). The artifact was tampered or the descriptor is stale.`,
			nextAction: "Do not install unverified bytes; obtain a descriptor whose integrity matches.",
			extra: { url: input.url, wasmUrl, pluginId: descriptor.id },
		});
	}

	// 7) Install: content-store the verified bytes, write the wasm + rewritten
	//    manifest (file:// entry) + version sentinel — the SAME on-disk shape a
	//    bundled/local install produces, so the runtime loads it identically.
	const sha256 = declaredHex; // verified equal above
	const integrity = `sha256-${sha256}`;
	const destDir = path.join(pluginsBaseDir(), pluginIdToFsToken(descriptor.id));
	await mkdir(destDir, { recursive: true });
	const wasmDest = path.join(destDir, "plugin.wasm");
	await writeFile(wasmDest, wasmBytes);

	// Content-addressed store (E2) — best-effort, never fatal (the file:// entry
	// works regardless), mirroring the bundled + local install paths.
	try {
		const stored = await createFsAssetStore(scopedAssetsDir("user")).store(wasmBytes);
		if (stored.hash !== sha256) {
			throw new Error(`content-store hash ${stored.hash} != install hash ${sha256}`);
		}
	} catch {
		// advisory: the file:// entry still loads.
	}

	// The descriptor IS the manifest template; rewrite entry/integrity to the local
	// content-store copy so the on-disk manifest is self-contained (no remote deref
	// at load), exactly like the local install.
	const installedManifest = {
		...descriptor,
		entry: `file://${wasmDest}`,
		integrity,
	};
	await writeFile(
		path.join(destDir, "plugin.json"),
		JSON.stringify(installedManifest, null, 2) + "\n",
		"utf-8",
	);

	const sentinel = sentinelPath(descriptor.id);
	await mkdir(path.dirname(sentinel), { recursive: true });
	await writeFile(
		sentinel,
		typeof descriptor.version === "string" ? descriptor.version : "0.0.0",
		"utf-8",
	);

	return buildJsonSuccessEnvelope({
		command: "plugin",
		operation: "install",
		nextCommand: "resume --json",
		nextCommands: ["resume --json"],
		extra: {
			pluginId: descriptor.id,
			installedFrom: input.url,
			installedTo: destDir,
			integrity,
			bytes: wasmBytes.byteLength,
		},
	});
}
