import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildUrlInstallReport,
	type UrlFetch,
	type UrlInstallReport,
} from "./plugin-install-from-url.js";
import { pluginIdToFsToken } from "./plugin-shared.js";

const tempRoots: string[] = [];
let prevHome: string | undefined;

// Real bytes + their real sha-256 — the same fixture the local-install test uses,
// so the content-address is genuine (the hash gate actually verifies).
const WASM_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x42]);
const WASM_SHA256 = "e7afd3a94acc8c9488c613adfb39d03db39536e70eb1c57d5f3798197122734f";
const WASM_INTEGRITY = `sha256-${WASM_SHA256}`;

const DESCRIPTOR_URL = "https://plugins.example/note-linter/plugin.json";
const WASM_URL = "https://plugins.example/note-linter/plugin.wasm";

const DESCRIPTOR = {
	id: "@example/note-linter",
	name: "Note Linter",
	version: "1.2.0",
	entry: "plugin.wasm", // relative to the descriptor URL — the install resolves it
	integrity: WASM_INTEGRITY,
	capabilities: { provides: ["quality:v1"], requires: [], providesApi: [], requiresApi: [] },
};

/** A stub fetch that serves the descriptor JSON and the wasm bytes from an in-memory
 * map. Anything else is a 404. No network is touched. */
function stubFetch(
	routes: {
		descriptor?: unknown;
		descriptorStatus?: number;
		wasm?: Uint8Array;
		wasmStatus?: number;
	} = {},
): UrlFetch {
	return async (url: string) => {
		if (url === DESCRIPTOR_URL) {
			const status = routes.descriptorStatus ?? 200;
			return {
				ok: status >= 200 && status < 300,
				status,
				statusText: status === 200 ? "OK" : "Error",
				json: async () => routes.descriptor,
				arrayBuffer: async () => new ArrayBuffer(0),
			};
		}
		if (url === WASM_URL) {
			const status = routes.wasmStatus ?? 200;
			const bytes = routes.wasm ?? WASM_BYTES;
			return {
				ok: status >= 200 && status < 300,
				status,
				statusText: status === 200 ? "OK" : "Error",
				json: async () => ({}),
				// Copy into a fresh ArrayBuffer so the return type is ArrayBuffer (not the
				// ArrayBufferLike a Uint8Array's .buffer may be, e.g. SharedArrayBuffer).
				arrayBuffer: async () => {
					const copy = new ArrayBuffer(bytes.byteLength);
					new Uint8Array(copy).set(bytes);
					return copy;
				},
			};
		}
		return {
			ok: false,
			status: 404,
			statusText: "Not Found",
			json: async () => ({}),
			arrayBuffer: async () => new ArrayBuffer(0),
		};
	};
}

beforeEach(() => {
	prevHome = process.env.REFARM_HOME;
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-url-home-"));
	tempRoots.push(home);
	process.env.REFARM_HOME = home;
});

afterEach(() => {
	if (prevHome === undefined) delete process.env.REFARM_HOME;
	else process.env.REFARM_HOME = prevHome;
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("plugin install from url — content-addressed remote install (ADR-086 Fase 7)", () => {
	it("fetches a descriptor, VERIFIES the wasm against its integrity, and installs", async () => {
		const report = (await buildUrlInstallReport({
			url: DESCRIPTOR_URL,
			fetchImpl: stubFetch({ descriptor: DESCRIPTOR, wasm: WASM_BYTES }),
		})) as UrlInstallReport;

		expect(report.ok).toBe(true);
		expect(report.pluginId).toBe("@example/note-linter");
		expect(report.installedFrom).toBe(DESCRIPTOR_URL);
		expect(report.integrity).toBe(WASM_INTEGRITY);
		expect(report.bytes).toBe(WASM_BYTES.byteLength);

		// It actually landed on disk under REFARM_HOME/plugins/<token>/ with a
		// self-contained manifest (file:// entry, no remote deref at load).
		const home = process.env.REFARM_HOME as string;
		const destDir = path.join(home, "plugins", pluginIdToFsToken("@example/note-linter"));
		expect(fs.existsSync(path.join(destDir, "plugin.wasm"))).toBe(true);
		const manifest = JSON.parse(fs.readFileSync(path.join(destDir, "plugin.json"), "utf-8")) as {
			entry: string;
			integrity: string;
		};
		expect(manifest.entry).toBe(`file://${path.join(destDir, "plugin.wasm")}`);
		expect(manifest.integrity).toBe(WASM_INTEGRITY);
	});

	it("REJECTS wasm whose hash does not match the declared integrity (the gate)", async () => {
		const tampered = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
		const report = await buildUrlInstallReport({
			url: DESCRIPTOR_URL,
			fetchImpl: stubFetch({ descriptor: DESCRIPTOR, wasm: tampered }),
		});

		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("url_integrity_mismatch");

		// Nothing was installed — the tampered bytes never reached disk.
		const home = process.env.REFARM_HOME as string;
		const destDir = path.join(home, "plugins", pluginIdToFsToken("@example/note-linter"));
		expect(fs.existsSync(path.join(destDir, "plugin.wasm"))).toBe(false);
	});

	it("fails loudly when the descriptor cannot be fetched", async () => {
		const report = await buildUrlInstallReport({
			url: DESCRIPTOR_URL,
			fetchImpl: stubFetch({ descriptorStatus: 404 }),
		});
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("url_descriptor_fetch_failed");
	});

	it("fails when the descriptor is missing required fields", async () => {
		const report = await buildUrlInstallReport({
			url: DESCRIPTOR_URL,
			fetchImpl: stubFetch({ descriptor: { name: "no id/entry/integrity" } }),
		});
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("url_descriptor_invalid");
	});

	it("fails when the declared integrity is not a sha256 hash", async () => {
		const report = await buildUrlInstallReport({
			url: DESCRIPTOR_URL,
			fetchImpl: stubFetch({
				descriptor: { ...DESCRIPTOR, integrity: "not-a-hash" },
			}),
		});
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("url_integrity_malformed");
	});

	it("fails when the wasm entry cannot be fetched", async () => {
		const report = await buildUrlInstallReport({
			url: DESCRIPTOR_URL,
			fetchImpl: stubFetch({ descriptor: DESCRIPTOR, wasmStatus: 500 }),
		});
		expect(report.ok).toBe(false);
		expect((report as { error: string }).error).toBe("url_wasm_fetch_failed");
	});

	it("installs a url descriptor whose entry is a .js (multi-kind), landing as plugin.js", async () => {
		// Multi-kind: a url descriptor can point at a .js entry, not only .wasm. The
		// same content-address gate applies; the entry lands under its own format.
		const JS_SOURCE = "export const activate = () => ({ ok: true });\n";
		const JS_BYTES = new Uint8Array(Buffer.from(JS_SOURCE));
		const JS_INTEGRITY = "sha256-89718240fd79892043c8a1096635d62f23ae7ef81940fdb7d70903af5b8be4ff";
		const JS_DESCRIPTOR_URL = "https://plugins.example/js-plugin/plugin.json";
		const JS_ENTRY_URL = "https://plugins.example/js-plugin/plugin.js";
		const jsFetch: UrlFetch = async (url: string) => {
			if (url === JS_DESCRIPTOR_URL) {
				return {
					ok: true,
					status: 200,
					statusText: "OK",
					json: async () => ({
						id: "@example/js-plugin",
						version: "0.3.0",
						entry: "plugin.js",
						integrity: JS_INTEGRITY,
					}),
					arrayBuffer: async () => new ArrayBuffer(0),
				};
			}
			if (url === JS_ENTRY_URL) {
				return {
					ok: true,
					status: 200,
					statusText: "OK",
					json: async () => ({}),
					arrayBuffer: async () => {
						const copy = new ArrayBuffer(JS_BYTES.byteLength);
						new Uint8Array(copy).set(JS_BYTES);
						return copy;
					},
				};
			}
			return {
				ok: false,
				status: 404,
				statusText: "Not Found",
				json: async () => ({}),
				arrayBuffer: async () => new ArrayBuffer(0),
			};
		};

		const report = (await buildUrlInstallReport({
			url: JS_DESCRIPTOR_URL,
			fetchImpl: jsFetch,
		})) as UrlInstallReport;

		expect(report.ok).toBe(true);
		expect(report.pluginId).toBe("@example/js-plugin");
		const home = process.env.REFARM_HOME as string;
		const destDir = path.join(home, "plugins", pluginIdToFsToken("@example/js-plugin"));
		// The entry landed as plugin.js, not forced to plugin.wasm.
		expect(fs.existsSync(path.join(destDir, "plugin.js"))).toBe(true);
		expect(fs.existsSync(path.join(destDir, "plugin.wasm"))).toBe(false);
		const manifest = JSON.parse(fs.readFileSync(path.join(destDir, "plugin.json"), "utf-8")) as {
			entry: string;
		};
		expect(manifest.entry).toBe(`file://${path.join(destDir, "plugin.js")}`);
	});
});
