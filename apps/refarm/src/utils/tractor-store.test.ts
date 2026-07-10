import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TractorStoreModule = typeof import("./tractor-store.js");

async function loadTractorStore(): Promise<TractorStoreModule> {
	return import("./tractor-store.js");
}

describe("tractor-store imports", () => {
	it("reads graph nodes from the runtime sidecar without loading experimental node sqlite", async () => {
		vi.resetModules();
		const warnings: string[] = [];
		const node = {
			"@context": "https://schema.org/",
			"@id": "urn:graph:one",
			"@type": "RefarmConfig",
			runtime: { sidecarUrl: "http://127.0.0.1:42001" },
		};
		const fetchMock = vi.fn(
			async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) =>
				new Response(JSON.stringify({ node }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(((
			warning: string | Error,
		) => {
			warnings.push(warning instanceof Error ? warning.message : warning);
		}) as typeof process.emitWarning);
		try {
			const { openTractorGraph } = await loadTractorStore();
			const graph = await openTractorGraph(
				{ REFARM_SIDECAR_URL: "http://sidecar.test", XDG_DATA_HOME: "/tmp/refarm-db-exists" },
				{ fetch: fetchMock },
			);
			await expect(graph?.getNode("urn:graph:one")).resolves.toEqual(node);
			expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
				"http://sidecar.test/nodes/urn%3Agraph%3Aone",
			);
			expect(warnings.join("\n")).not.toMatch(/SQLite is an experimental feature|node:sqlite/);
		} finally {
			warningSpy.mockRestore();
		}
	});
});

describe("resolveTractorNamespace", () => {
	it("defaults to 'default' (the daemon's clap default) when REFARM_NAMESPACE is unset", async () => {
		const { resolveTractorNamespace } = await loadTractorStore();
		expect(resolveTractorNamespace({})).toBe("default");
	});

	it("uses REFARM_NAMESPACE when set (trimmed)", async () => {
		const { resolveTractorNamespace } = await loadTractorStore();
		expect(resolveTractorNamespace({ REFARM_NAMESPACE: "  proj  " })).toBe("proj");
	});

	it("ignores an empty REFARM_NAMESPACE", async () => {
		const { resolveTractorNamespace } = await loadTractorStore();
		expect(resolveTractorNamespace({ REFARM_NAMESPACE: "   " })).toBe("default");
	});
});

describe("resolveTractorDbPath", () => {
	it("mirrors the launcher: XDG_DATA_HOME/refarm/{namespace}.db when set", async () => {
		const { resolveTractorDbPath } = await loadTractorStore();
		expect(resolveTractorDbPath({ XDG_DATA_HOME: "/x/data", REFARM_NAMESPACE: "ns" })).toBe(
			path.join("/x/data", "refarm", "ns.db"),
		);
	});

	it("falls back to REFARM_HOME/data (the launcher default) when XDG unset", async () => {
		const { resolveTractorDbPath } = await loadTractorStore();
		expect(resolveTractorDbPath({ REFARM_HOME: "/repo/.refarm" })).toBe(
			path.join("/repo/.refarm", "data", "refarm", "default.db"),
		);
	});
});

describe("openTractorGraph", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(path.join(tmpdir(), "tractor-store-"));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("returns null from the direct sqlite fallback when the db file does not exist", async () => {
		const { openDirectTractorGraph } = await loadTractorStore();
		// XDG points at an empty dir → no {ns}.db → null, never a thrown error.
		await expect(openDirectTractorGraph({ XDG_DATA_HOME: dir })).resolves.toBeNull();
	});
});
