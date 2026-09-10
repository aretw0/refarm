import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	MODEL_RATE_CATALOG_FILE_NAME,
	materializeDefaultModelRateCatalog,
	modelRateCatalogPath,
	modelRateCatalogRecordPath,
} from "../../src/commands/model-rate-catalog.js";

/**
 * The host has NO compiled-in catalog. If this materialisation stops working the daemon
 * injects nothing and every run prices from the agent's built-in table instead of the
 * audited artifact — silently, because falling back is the correct behaviour for an absent
 * catalog. So the tests below are the only thing standing between "the artifact reaches the
 * runtime" and "it quietly stopped".
 *
 * They also pin the FOUR answers of the managed-file pattern, which exists because the two
 * obvious designs are both wrong: create-if-absent strands a node on last release's rates
 * forever, and always-overwrite destroys the rate a node corrected. Each state below is a
 * separate test because collapsing any two of them is exactly how one of those two wrong
 * designs comes back.
 *
 * Every test drives an INJECTED `REFARM_HOME` — the suite setup points the real one at a
 * throwaway dir on purpose, and a test that leans on that is a test that stops meaning
 * anything the day the setup changes.
 */

const created: string[] = [];

function sandbox(): NodeJS.ProcessEnv {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-catalog-"));
	created.push(home);
	return { REFARM_HOME: home };
}

afterEach(() => {
	for (const dir of created.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** The audited artifact, read the same way the pass reads it. */
function shippedCatalog(): string {
	return fs.readFileSync(
		path.resolve(
			import.meta.dirname,
			"../../../../packages/model-catalog-v1/catalog",
			MODEL_RATE_CATALOG_FILE_NAME,
		),
		"utf-8",
	);
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** A catalog this node did NOT get from the shipped package. */
function localCatalog(catalogVersion: string, inputRate: number): string {
	return JSON.stringify({
		schemaVersion: "model-rate-catalog.v1",
		catalogVersion,
		entries: [
			{
				provider: "anthropic",
				match: { mode: "contains", value: "claude-sonnet-5" },
				rate: { inputPerMTokenUsd: inputRate, outputPerMTokenUsd: 7 },
				pricingUrl: "https://example.invalid/negotiated",
				verifiedAt: "2026-08-04",
			},
		],
	});
}

/** Write the provenance record this pass would have written for `bytes`. */
function writeRecordFor(env: NodeJS.ProcessEnv, bytes: string, catalogVersion: string): void {
	fs.writeFileSync(
		modelRateCatalogRecordPath(env),
		JSON.stringify({
			schemaVersion: "model-rate-catalog-managed.v1",
			file: MODEL_RATE_CATALOG_FILE_NAME,
			sha256: sha256(bytes),
			catalogVersion,
			writtenAt: "2026-01-01T00:00:00.000Z",
		}),
	);
}

function seed(env: NodeJS.ProcessEnv, bytes: string): string {
	const target = modelRateCatalogPath(env);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, bytes);
	return target;
}

function readRecord(env: NodeJS.ProcessEnv): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(modelRateCatalogRecordPath(env), "utf-8")) as Record<
		string,
		unknown
	>;
}

describe("materializeDefaultModelRateCatalog — no catalog file", () => {
	it("writes the shipped artifact where the host looks for it, and records what it wrote", () => {
		const env = sandbox();
		const result = materializeDefaultModelRateCatalog(env);

		expect(result.status).toBe("materialized");
		expect(result.path).toBe(path.join(env.REFARM_HOME!, MODEL_RATE_CATALOG_FILE_NAME));
		expect(result.path).toBe(modelRateCatalogPath(env));

		// The bytes must be the audited artifact, not a re-serialisation of it: the Rust
		// host validates what it reads with the same rules the package enforces, and a
		// reshaped file is a second source.
		const written = fs.readFileSync(result.path, "utf-8");
		expect(written).toBe(shippedCatalog());

		const catalog = JSON.parse(written) as { schemaVersion: string; entries: unknown[] };
		expect(catalog.schemaVersion).toBe("model-rate-catalog.v1");
		expect(catalog.entries.length).toBeGreaterThan(0);

		// The record is what makes the NEXT pass able to tell our copy from an edit. It
		// pins the exact bytes, not a version string an editor could leave untouched.
		const record = readRecord(env);
		expect(record.sha256).toBe(sha256(written));
		expect(record.catalogVersion).toBe(result.localCatalogVersion);
		expect(record.file).toBe(MODEL_RATE_CATALOG_FILE_NAME);
		expect(typeof record.writtenAt).toBe("string");
	});

	it("creates the sovereign dir when it does not exist yet", () => {
		const env = sandbox();
		const home = path.join(env.REFARM_HOME!, "nested", "never-created");
		const result = materializeDefaultModelRateCatalog({ REFARM_HOME: home });
		expect(result.status).toBe("materialized");
		expect(fs.existsSync(path.join(home, MODEL_RATE_CATALOG_FILE_NAME))).toBe(true);
	});

	it("re-materializes after the operator deletes the file to force a refresh", () => {
		const env = sandbox();
		const target = modelRateCatalogPath(env);
		expect(materializeDefaultModelRateCatalog(env).status).toBe("materialized");

		fs.rmSync(target);
		// The record is now an orphan describing a file that is gone. It must not stop the
		// pass from writing again — this is the documented way out of `edited`/`unknown`.
		expect(materializeDefaultModelRateCatalog(env).status).toBe("materialized");
		expect(fs.readFileSync(target, "utf-8")).toBe(shippedCatalog());
	});
});

describe("materializeDefaultModelRateCatalog — our copy, untouched", () => {
	it("is idempotent: a second call reports kept and writes nothing", () => {
		const env = sandbox();
		const first = materializeDefaultModelRateCatalog(env);
		expect(first.status).toBe("materialized");
		const stamp = fs.statSync(first.path).mtimeMs;

		const second = materializeDefaultModelRateCatalog(env);
		expect(second.status).toBe("kept");
		expect(second.path).toBe(first.path);
		expect(second.message).toBeUndefined();
		expect(second.localCatalogVersion).toBe(second.shippedCatalogVersion);
		expect(fs.statSync(first.path).mtimeMs).toBe(stamp);
	});

	it("UPDATES a stale copy it wrote itself — the whole reason the record exists", () => {
		const env = sandbox();
		// A node that materialised an older release: the bytes on disk are ours (the record
		// says so) and they are no longer the bytes we ship.
		const stale = localCatalog("2026-01-01.1", 3);
		const target = seed(env, stale);
		writeRecordFor(env, stale, "2026-01-01.1");

		const result = materializeDefaultModelRateCatalog(env);

		expect(result.status).toBe("updated");
		expect(fs.readFileSync(target, "utf-8")).toBe(shippedCatalog());
		expect(result.localCatalogVersion).toBe(result.shippedCatalogVersion);
		expect(result.localCatalogVersion).not.toBe("2026-01-01.1");

		// The record moves with the file, so the next pass reports `kept`, not a second update.
		expect(readRecord(env).sha256).toBe(sha256(shippedCatalog()));
		expect(materializeDefaultModelRateCatalog(env).status).toBe("kept");
	});

	it("leaves no staged temp file behind after an update", () => {
		const env = sandbox();
		const stale = localCatalog("2026-01-01.1", 3);
		seed(env, stale);
		writeRecordFor(env, stale, "2026-01-01.1");

		expect(materializeDefaultModelRateCatalog(env).status).toBe("updated");
		const leftovers = fs
			.readdirSync(env.REFARM_HOME!)
			.filter((entry) => entry.endsWith(".tmp"));
		expect(leftovers).toEqual([]);
	});
});

describe("materializeDefaultModelRateCatalog — the operator edited it", () => {
	it("keeps an edited catalog BYTE-IDENTICAL and reports the newer shipped version", () => {
		const env = sandbox();
		// The node materialised normally, then corrected a rate by hand — the exact act the
		// whole design protects.
		expect(materializeDefaultModelRateCatalog(env).status).toBe("materialized");
		const shippedVersion = materializeDefaultModelRateCatalog(env).shippedCatalogVersion;
		expect(typeof shippedVersion).toBe("string");

		const target = modelRateCatalogPath(env);
		const corrected = localCatalog("node-local.1", 1.5);
		fs.writeFileSync(target, corrected);

		// Every restart runs this pass again. Every restart must leave the file alone —
		// and must SAY that a newer catalog exists and this node is not on it, rather than
		// keeping quiet and letting the operator believe they are current.
		for (let restart = 0; restart < 3; restart += 1) {
			const result = materializeDefaultModelRateCatalog(env);
			expect(result.status).toBe("edited");
			expect(fs.readFileSync(target, "utf-8")).toBe(corrected);
			expect(result.localCatalogVersion).toBe("node-local.1");
			expect(result.shippedCatalogVersion).toBe(shippedVersion);
			// Both versions in the sentence, and the way out named.
			expect(result.message).toContain("node-local.1");
			expect(result.message).toContain(String(shippedVersion));
			expect(result.message).toContain(target);
		}
	});

	it("does not claim a newer catalog ships when the edit did not change the version", () => {
		const env = sandbox();
		const first = materializeDefaultModelRateCatalog(env);
		expect(first.status).toBe("materialized");

		// Same catalogVersion, different bytes: an operator who tuned one rate in place.
		const target = modelRateCatalogPath(env);
		const shipped = JSON.parse(shippedCatalog()) as Record<string, unknown>;
		const tweaked = JSON.stringify({ ...shipped, entries: [] });
		fs.writeFileSync(target, tweaked);

		const result = materializeDefaultModelRateCatalog(env);
		expect(result.status).toBe("edited");
		expect(result.message).not.toContain("newer catalog ships");
		expect(fs.readFileSync(target, "utf-8")).toBe(tweaked);
	});
});

describe("materializeDefaultModelRateCatalog — provenance unknown", () => {
	it("keeps a pre-record catalog, reports it as unknown, and names the way out", () => {
		const env = sandbox();
		// EVERY node that materialised before the record existed is in this state, the
		// operator's own included. There is nothing on disk that distinguishes "last
		// release's copy" from "a correction", so the pass claims neither.
		const preexisting = localCatalog("2026-07-01.2", 3);
		const target = seed(env, preexisting);
		expect(fs.existsSync(modelRateCatalogRecordPath(env))).toBe(false);

		for (let restart = 0; restart < 2; restart += 1) {
			const result = materializeDefaultModelRateCatalog(env);
			expect(result.status).toBe("unknown");
			expect(fs.readFileSync(target, "utf-8")).toBe(preexisting);
			expect(result.localCatalogVersion).toBe("2026-07-01.2");
			expect(typeof result.shippedCatalogVersion).toBe("string");
			expect(result.message).toContain(target);
		}

		// Reporting `unknown` must not quietly write a record either — that would promote a
		// guess to a fact and hand the next pass permission to overwrite.
		expect(fs.existsSync(modelRateCatalogRecordPath(env))).toBe(false);
	});

	it("treats a corrupt or foreign record as no record at all", () => {
		const env = sandbox();
		const preexisting = localCatalog("2026-07-01.2", 3);
		seed(env, preexisting);

		for (const record of [
			"{ not json",
			JSON.stringify({ sha256: sha256(preexisting) }), // no schema tag
			JSON.stringify({ schemaVersion: "something-else.v9", sha256: sha256(preexisting) }),
			JSON.stringify({ schemaVersion: "model-rate-catalog-managed.v1" }), // no hash
		]) {
			fs.writeFileSync(modelRateCatalogRecordPath(env), record);
			const result = materializeDefaultModelRateCatalog(env);
			// Strictness costs a report line; guessing would cost an operator their edit.
			expect(result.status).toBe("unknown");
			expect(fs.readFileSync(modelRateCatalogPath(env), "utf-8")).toBe(preexisting);
		}
	});
});

describe("materializeDefaultModelRateCatalog — concurrency", () => {
	it("never lets a half-written catalog wear the name the host reads", () => {
		const env = sandbox();
		const target = modelRateCatalogPath(env);
		const home = env.REFARM_HOME!;

		const seenDuringStaging: string[][] = [];
		const innerResults: string[] = [];
		const originalLink = fs.linkSync;
		let reentered = false;

		fs.linkSync = ((source: fs.PathLike, destination: fs.PathLike) => {
			if (!reentered) {
				reentered = true;
				// A whole second pass runs while the first has its bytes staged but not yet
				// moved into place — the exact window two nodes starting at once occupy.
				seenDuringStaging.push(fs.readdirSync(home));
				innerResults.push(materializeDefaultModelRateCatalog(env).status);
			}
			return originalLink(source, destination);
		}) as typeof fs.linkSync;

		let outer: string;
		try {
			outer = materializeDefaultModelRateCatalog(env).status;
		} finally {
			fs.linkSync = originalLink;
		}

		// While the first pass was mid-write, the staged bytes were NOT visible under the
		// host's filename. A reader in that window sees no catalog (and prices from the
		// built-in table) rather than a truncated one.
		expect(seenDuringStaging[0]).not.toContain(MODEL_RATE_CATALOG_FILE_NAME);
		expect(seenDuringStaging[0]?.some((entry) => entry.endsWith(".tmp"))).toBe(true);

		// The inner pass created it; the outer pass lost the race and refused to clobber.
		expect(innerResults).toEqual(["materialized"]);
		expect(outer).toBe("kept");

		// One whole catalog, one matching record, no debris.
		const written = fs.readFileSync(target, "utf-8");
		expect(written).toBe(shippedCatalog());
		expect(readRecord(env).sha256).toBe(sha256(written));
		expect(fs.readdirSync(home).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
		expect(materializeDefaultModelRateCatalog(env).status).toBe("kept");
	});

	it("refuses to replace a copy that was edited AFTER this pass classified it", () => {
		const env = sandbox();
		const stale = localCatalog("2026-01-01.1", 3);
		const target = seed(env, stale);
		writeRecordFor(env, stale, "2026-01-01.1");

		// The update path staged its replacement, and only then did the operator save their
		// correction. Re-verifying immediately before the move is what keeps "never
		// overwrite an edit" true across that window instead of merely likely.
		const corrected = localCatalog("node-local.1", 1.5);

		// Inject through the read the replace path performs just before the move.
		const originalReadFileSync = fs.readFileSync;
		let reads = 0;
		fs.readFileSync = ((file: fs.PathOrFileDescriptor, options?: unknown) => {
			const bytes = (originalReadFileSync as (f: unknown, o?: unknown) => unknown)(
				file,
				options,
			);
			if (String(file) === target) {
				reads += 1;
				// Read 1 is the classification (it must still see OUR stale copy, or the pass
				// short-circuits to `edited` and never reaches the window under test). The
				// operator's save lands right after it, so read 2 — the re-verify immediately
				// before the move — is the one that has to catch it.
				if (reads === 1) fs.writeFileSync(target, corrected);
			}
			return bytes;
		}) as typeof fs.readFileSync;

		let result: ReturnType<typeof materializeDefaultModelRateCatalog>;
		try {
			result = materializeDefaultModelRateCatalog(env);
		} finally {
			fs.readFileSync = originalReadFileSync;
		}

		expect(result.status).toBe("kept");
		expect(fs.readFileSync(target, "utf-8")).toBe(corrected);
		expect(result.message).toContain("left untouched");
		expect(fs.readdirSync(env.REFARM_HOME!).filter((e) => e.endsWith(".tmp"))).toEqual([]);
	});
});
