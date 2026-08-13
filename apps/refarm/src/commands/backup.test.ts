import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	BUNDLE_FILES_DIR,
	MANIFEST_NAME,
	readSiloSplit,
	restoreBundle,
	storedPathFor,
	surveyHome,
	verifyBundle,
	writeBundle,
} from "./backup.js";

/**
 * BACKUP NÃO TESTADO NÃO É BACKUP.
 *
 * The round trip below is the assertion that matters: build a node, export it, DESTROY the home,
 * restore, and compare. Everything else here is a way for that to fail loudly instead of quietly.
 */
let home: string;
let bundle: string;

function write(relative: string, content: string) {
	const file = path.join(home, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
	return file;
}

/** A node shaped like the operator's: declared config, identity, a live database, a silo with
 *  secrets in it, a managed cache, and scratch nobody declared. */
function buildNode() {
	write(".refarm/config.json", JSON.stringify({ workspaces: { refarm: { path: "/w" } } }));
	write(".refarm/node-id", "f17151b4-35f2-4f46-b43a-0ff03514a874");
	write(".refarm/node.json", JSON.stringify({ name: "sede" }));
	write(".refarm/data/refarm/default.db", "SQLITE-DATA");
	write(".refarm/model-rates.v1.json", "{}");
	write(".refarm/config.json.bak-antes-do-batismo", "{}");
	write(".local/share/refarm/repro.db", "SCRATCH");
	write(
		".silo/identity.json",
		JSON.stringify({
			tokens: {
				modelProvider: "openai-codex",
				modelId: "gpt-5.5",
				oauthCredentials: { "openai-codex": { access: "SECRET-TOKEN" } },
				githubToken: "gho_SECRET",
				githubOwner: "arthur",
			},
		}),
	);
}

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-backup-home-"));
	bundle = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-backup-bundle-"));
	buildNode();
});

afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
	fs.rmSync(bundle, { recursive: true, force: true });
});

function exportNode() {
	const { plan } = surveyHome(home, "default");
	const silo = readSiloSplit(home);
	return { manifest: writeBundle(home, bundle, plan.carry, plan.undecidable, silo), plan, silo };
}

describe("the round trip", () => {
	it("restores a destroyed node's declared state, byte for byte", () => {
		// THE ASSERTION THE WHOLE ITEM EXISTS FOR (ISS-123). Not "the files were copied" — the home
		// is deleted between export and restore, which is the reformat the operator is afraid of.
		const before = new Map(
			[".refarm/config.json", ".refarm/node-id", ".refarm/node.json", ".refarm/data/refarm/default.db"].map(
				(relative) => [relative, fs.readFileSync(path.join(home, relative), "utf8")],
			),
		);
		exportNode();

		fs.rmSync(home, { recursive: true, force: true });
		fs.mkdirSync(home, { recursive: true });

		restoreBundle(bundle, home);
		for (const [relative, content] of before) {
			expect(fs.readFileSync(path.join(home, relative), "utf8"), relative).toBe(content);
		}
	});

	it("restores into a DIFFERENT home, because the point is another machine", () => {
		// The bundle stores relative paths, so it must not depend on the home it came from. A backup
		// that only restores onto the same absolute path is a backup that cannot move.
		exportNode();
		const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-other-home-"));
		try {
			restoreBundle(bundle, elsewhere);
			expect(fs.readFileSync(path.join(elsewhere, ".refarm/node-id"), "utf8")).toContain("f17151b4");
		} finally {
			fs.rmSync(elsewhere, { recursive: true, force: true });
		}
	});
});

describe("what the bundle refuses to carry", () => {
	it("contains NO secret anywhere in it, checked by reading every byte written", () => {
		// Not "the silo file was skipped" — every file in the bundle plus the manifest is searched,
		// because the way a secret escapes is through a path nobody thought to check.
		exportNode();
		const everything: string[] = [];
		const walk = (dir: string) => {
			for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, item.name);
				if (item.isDirectory()) walk(full);
				else everything.push(fs.readFileSync(full, "utf8"));
			}
		};
		walk(bundle);
		const all = everything.join("\n");
		expect(all).not.toContain("SECRET-TOKEN");
		expect(all).not.toContain("gho_SECRET");
	});

	it("carries the DECISIONS the secrets sat next to", () => {
		// The other half. Dropping the silo entirely would lose the model route, which is a decision
		// no login rebuilds — that is precisely what ISS-121 destroyed.
		const { manifest } = exportNode();
		expect(manifest.decisions).toMatchObject({
			modelProvider: "openai-codex",
			modelId: "gpt-5.5",
			githubOwner: "arthur",
		});
		expect(manifest.reAuthenticate).toEqual(["github", "openai-codex"]);
	});

	it("does not carry a managed cache or undeclared scratch", () => {
		const { manifest } = exportNode();
		const stored = manifest.files.map((file) => file.stored);
		expect(stored).not.toContain(path.join(".refarm", "model-rates.v1.json"));
		expect(stored).not.toContain(path.join(".local", "share", "refarm", "repro.db"));
	});

	it("RECORDS what it could not decide, so a restore knows the backup was partial", () => {
		// The hand-made backup and the scratch database are irrecoverable and undeclared. Silently
		// dropping them would make an incomplete bundle look complete.
		const { manifest } = exportNode();
		const undecided = manifest.undecided.map((entry) => entry.file);
		expect(undecided.some((file) => file.includes("bak-antes-do-batismo"))).toBe(true);
		expect(undecided.some((file) => file.includes("repro.db"))).toBe(true);
		expect(manifest.undecided.every((entry) => entry.reason.length > 20)).toBe(true);
	});
});

describe("verifyBundle", () => {
	it("calls a fresh bundle intact", () => {
		exportNode();
		expect(verifyBundle(bundle)).toMatchObject({ state: "intact", problems: [] });
	});

	it("catches a file whose bytes moved after it was written", () => {
		const { manifest } = exportNode();
		const first = manifest.files[0]!;
		fs.writeFileSync(path.join(bundle, BUNDLE_FILES_DIR, first.stored), "tampered");
		const verdict = verifyBundle(bundle);
		expect(verdict.state).toBe("damaged");
		expect(verdict.problems[0]).toContain("digest does not match");
	});

	it("catches a file the manifest names and the bundle lacks", () => {
		const { manifest } = exportNode();
		fs.rmSync(path.join(bundle, BUNDLE_FILES_DIR, manifest.files[0]!.stored));
		expect(verifyBundle(bundle).problems[0]).toContain("not present");
	});

	it("separates UNREADABLE from damaged", () => {
		// A wrong directory and a corrupt bundle are different mistakes with different fixes. Calling
		// the first "damaged" sends an operator hunting for corruption that does not exist.
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-empty-"));
		try {
			expect(verifyBundle(empty).state).toBe("unreadable");
			expect(verifyBundle(empty).problems[0]).toContain(MANIFEST_NAME);
		} finally {
			fs.rmSync(empty, { recursive: true, force: true });
		}
	});

	it("REFUSES to restore anything from a damaged bundle", () => {
		// Half a restore is worse than none: it leaves a node that looks configured and is not.
		const { manifest } = exportNode();
		fs.writeFileSync(path.join(bundle, BUNDLE_FILES_DIR, manifest.files[0]!.stored), "tampered");
		const target = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-target-"));
		try {
			expect(() => restoreBundle(bundle, target)).toThrow(/refusing to restore a damaged bundle/u);
			expect(fs.readdirSync(target)).toEqual([]);
		} finally {
			fs.rmSync(target, { recursive: true, force: true });
		}
	});
});

describe("storedPathFor", () => {
	it("keeps a path inside the home relative", () => {
		expect(storedPathFor("/home/op/.refarm/config.json", "/home/op")).toBe(
			path.join(".refarm", "config.json"),
		);
	});

	it("refuses to let a path outside the home escape the bundle with ..", () => {
		// A `..` in a stored path would write outside the target on restore. It lands under a marker
		// instead, where it is visible rather than surprising.
		expect(storedPathFor("/etc/somewhere", "/home/op")).toBe(path.join("_absolute", "etc", "somewhere"));
	});
});

describe("readSiloSplit", () => {
	it("reports an absent silo as absent, not as an empty node", () => {
		fs.rmSync(path.join(home, ".silo"), { recursive: true, force: true });
		expect(readSiloSplit(home)).toEqual({ decisions: {}, reAuthenticate: [] });
	});

	it("survives a silo that is not JSON at all", () => {
		fs.writeFileSync(path.join(home, ".silo", "identity.json"), "not json{");
		expect(readSiloSplit(home).reAuthenticate).toEqual([]);
	});
});
