import { describe, expect, it } from "vitest";

import { createRecordFileWriter, materializeRecordFiles, type RecordFileWriterOptions } from "./node.js";
import type { RecordFilePlan } from "./organize.js";

/** An in-memory fs so the writer is tested without touching disk. */
function memoryFs(seed: Record<string, string> = {}) {
	const store = new Map(Object.entries(seed));
	return {
		store,
		fs: {
			readFileSync: (file: string): string => {
				if (!store.has(file)) throw new Error(`ENOENT ${file}`);
				return store.get(file)!;
			},
			writeFileSync: (file: string, data: string): void => {
				store.set(file, data);
			},
			mkdirSync: (): void => {},
		} as RecordFileWriterOptions["fs"],
	};
}

describe("createRecordFileWriter — idempotent write", () => {
	it("writes an absent file", () => {
		const { store, fs } = memoryFs();
		const write = createRecordFileWriter({ root: "/v", fs });
		expect(write("a.md", "hello")).toBe("written");
		expect(store.get("/v/a.md")).toBe("hello");
	});

	it("skips a file whose content is identical", () => {
		const { fs } = memoryFs({ "/v/a.md": "hello" });
		const write = createRecordFileWriter({ root: "/v", fs });
		expect(write("a.md", "hello")).toBe("skipped");
	});

	it("rewrites a file whose content changed", () => {
		const { store, fs } = memoryFs({ "/v/a.md": "old" });
		const write = createRecordFileWriter({ root: "/v", fs });
		expect(write("a.md", "new")).toBe("written");
		expect(store.get("/v/a.md")).toBe("new");
	});

	it("normalizeForCompare excludes a volatile line so it doesn't force a rewrite", () => {
		const stripSync = (t: string): string => t.replace(/^synced:.*$\n?/m, "");
		const { fs } = memoryFs({ "/v/a.md": "title: X\nsynced: 2026-01-01\nbody" });
		const write = createRecordFileWriter({ root: "/v", fs, normalizeForCompare: stripSync });
		// Same but for the synced line → skipped.
		expect(write("a.md", "title: X\nsynced: 2026-07-13\nbody")).toBe("skipped");
		// A real content change → written.
		expect(write("a.md", "title: Y\nsynced: 2026-07-13\nbody")).toBe("written");
	});
});

describe("materializeRecordFiles", () => {
	const plans: RecordFilePlan[] = [
		{ recordId: "a", destination: "", fileName: "a.md", relativePath: "a.md", text: "AAA" },
		{ recordId: "b", destination: "área", fileName: "b.md", relativePath: "área/b.md", text: "BBB" },
	];

	it("writes all plans on a fresh vault and tallies", () => {
		const { store, fs } = memoryFs();
		const result = materializeRecordFiles(plans, { root: "/v", fs });
		expect(result.written).toBe(2);
		expect(result.skipped).toBe(0);
		expect(store.get("/v/a.md")).toBe("AAA");
		expect(store.get("/v/área/b.md")).toBe("BBB");
	});

	it("is idempotent — a second materialize of unchanged plans skips all", () => {
		const { fs } = memoryFs();
		materializeRecordFiles(plans, { root: "/v", fs });
		const second = materializeRecordFiles(plans, { root: "/v", fs });
		expect(second.written).toBe(0);
		expect(second.skipped).toBe(2);
	});
});
