import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	openTractorGraph,
	resolveTractorDbPath,
	resolveTractorNamespace,
} from "./tractor-store.js";

describe("resolveTractorNamespace", () => {
	it("defaults to 'default' (the daemon's clap default) when REFARM_NAMESPACE is unset", () => {
		expect(resolveTractorNamespace({})).toBe("default");
	});

	it("uses REFARM_NAMESPACE when set (trimmed)", () => {
		expect(resolveTractorNamespace({ REFARM_NAMESPACE: "  proj  " })).toBe(
			"proj",
		);
	});

	it("ignores an empty REFARM_NAMESPACE", () => {
		expect(resolveTractorNamespace({ REFARM_NAMESPACE: "   " })).toBe("default");
	});
});

describe("resolveTractorDbPath", () => {
	it("mirrors the launcher: XDG_DATA_HOME/refarm/{namespace}.db when set", () => {
		expect(
			resolveTractorDbPath({ XDG_DATA_HOME: "/x/data", REFARM_NAMESPACE: "ns" }),
		).toBe(path.join("/x/data", "refarm", "ns.db"));
	});

	it("falls back to REFARM_HOME/data (the launcher default) when XDG unset", () => {
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

	it("returns null when the db file does not exist (runtime never ran)", () => {
		// XDG points at an empty dir → no {ns}.db → null, never a thrown error.
		expect(openTractorGraph({ XDG_DATA_HOME: dir })).toBeNull();
	});
});
