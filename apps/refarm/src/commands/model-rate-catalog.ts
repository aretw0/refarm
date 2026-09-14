import { resolvePluginPackage } from "@refarm.dev/barn";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveRefarmHome } from "../utils/refarm-home.js";

/**
 * PUT THE SHIPPED RATE CATALOG WHERE THE HOST WILL LOOK FOR IT, AND KEEP IT CURRENT
 * WITHOUT EVER DESTROYING A NODE'S OWN CORRECTION.
 *
 * The Rust host prices every run from `MODEL_RATE_CATALOG`, a JSON string it puts on the
 * guest's WASI env, and it resolves that string from exactly ONE place: a file named
 * `model-rates.v1.json` in the node's sovereign dir
 * (`packages/tractor/src/host/plugin_host/model_rate_catalog.rs`). It has no compiled-in
 * default. It used to — an `include_str!` of
 * `packages/model-catalog-v1/catalog/model-rates.v1.json` — and that made `refarm-tractor`
 * unpublishable, because the path climbs out of the crate and `cargo package` never copies
 * it. Deleting the embed left the host reading a file nobody wrote. This is who writes it.
 *
 * TypeScript can do this and the host cannot: the artifact lives in an npm package, and
 * resolving an npm package is a thing Node does and a WASM host does not.
 *
 * WHY HERE, on the bundled-artifact pass. `refarm plugin install --bundled` (and its alias
 * `plugin update`) is already the step that resolves shipped npm packages and copies their
 * artifacts into `<REFARM_HOME>`, and `scripts/tractor-start.sh` already runs it before
 * every daemon start. So the catalog rides a path that exists, runs on every start, and
 * lands in the same directory the daemon derives from its `--refarm-dir`. No new command,
 * no new moment.
 *
 * ── THE PROBLEM THIS FILE USED TO HAVE ──────────────────────────────────────────────
 *
 * The first version of this pass was create-if-absent and nothing else. It never
 * overwrote — correct, and load bearing, because a node corrects a rate by editing this
 * exact file and that correction must survive every restart. But it also meant a node
 * that had the file once kept it FOREVER: a shipped catalog with a fixed rate could not
 * reach the machine, not on restart, not on `plugin update`. Refreshing was a manual
 * `rm`. The corrected rate existed in the repo and could not reach the operator.
 *
 * "Always overwrite" is not the fix — that trades a stale rate for a destroyed one, which
 * is strictly worse. The fix is to RECORD WHAT WE WROTE, so a later pass can tell an
 * untouched copy of ours from a file the operator changed.
 *
 * ── THE MANAGED-FILE PATTERN: FOUR ANSWERS, NEVER THREE ─────────────────────────────
 *
 * Beside the catalog sits a provenance record (see `MODEL_RATE_CATALOG_RECORD_FILE_NAME`)
 * holding the SHA-256 of the exact bytes this pass wrote, the `catalogVersion` those bytes
 * carried, and when. Every pass then answers one of:
 *
 *   no file                        → write it, record it            (`materialized`)
 *   file, hash == record, stale    → replace it, re-record it       (`updated`)
 *   file, hash == record, current  → nothing to do                  (`kept`)
 *   file, hash != record           → THE OPERATOR EDITED IT. Keep it, and say that a
 *                                    newer catalog ships and this node is not on it.
 *                                                                   (`edited`)
 *   file, NO record                → provenance unknown. Keep it, and SAY SO.
 *                                                                   (`unknown`)
 *
 * That last one is not a rounding error, it is the state EVERY node materialised before
 * this change is in — including the operator's own. Collapsing it into "ours" would
 * overwrite a correction made before the record existed; collapsing it into "edited"
 * would tell an operator they changed a file they never opened. Neither is knowable from
 * disk, so neither is claimed: the file is kept and the ambiguity is reported with the
 * one command that resolves it.
 *
 * ── WHY THE RECORD LIVES NEXT TO THE CATALOG ────────────────────────────────────────
 *
 * Same directory, so the record shares the catalog's fate: one `cp -r ~/.refarm`, one
 * backup, one restore, one delete of the sovereign dir moves or removes both together.
 * A record in some other tree would survive a catalog it no longer describes and start
 * lying. It is dot-prefixed because it is bookkeeping this pass owns and no one should
 * hand-edit — the same reason the plugin version sentinels live in `plugins/.versions/`.
 * Its basename is DERIVED from the catalog's, so the pair cannot drift apart in source.
 *
 * A wrong or missing record is never dangerous: every path it can fail on lands on
 * `unknown` or `edited`, and both of those KEEP the file on disk.
 *
 * ── EVERY WRITE IS STAGED ───────────────────────────────────────────────────────────
 *
 * Nothing here truncates a live file. Bytes go to a sibling temp first and then move into
 * place — `link(2)` when creating (create-if-absent atomically, so a concurrent pass
 * cannot be clobbered) and `rename(2)` when replacing our own copy (atomic swap, so no
 * reader ever sees a half-written catalog; the host refuses a truncated one anyway).
 * The replace path re-reads and re-verifies the hash immediately before the move, so the
 * "never overwrite an edit" rule holds even against a write that lands mid-pass.
 *
 * Never throws. A node that cannot be given a catalog still runs; the host injects none
 * and the guest falls back to its built-in table, which is "I do not know prices", never
 * "free".
 */

/** The basename the host reads. MUST equal `CATALOG_FILE_NAME` in
 *  `packages/tractor/src/host/plugin_host/model_rate_catalog.rs` — the two sides agree on
 *  this name and on nothing else. */
export const MODEL_RATE_CATALOG_FILE_NAME = "model-rates.v1.json";

/** The provenance record's basename, DERIVED from the catalog's so the pair cannot drift.
 *  The host never reads this file; it reads exactly `MODEL_RATE_CATALOG_FILE_NAME`. */
export const MODEL_RATE_CATALOG_RECORD_FILE_NAME = `.${MODEL_RATE_CATALOG_FILE_NAME}.managed.json`;

/** Schema tag on the record, so a future shape change is a rename and not a guess. An
 *  unrecognised tag reads as "no record", which keeps the catalog and reports `unknown`. */
const MODEL_RATE_CATALOG_RECORD_SCHEMA = "model-rate-catalog-managed.v1";

/** The package that OWNS the artifact. Both sides are readers of it; neither authors. */
const MODEL_RATE_CATALOG_PACKAGE = {
	npmPackage: "@refarm.dev/model-catalog-v1",
	workspaceDir: "packages/model-catalog-v1",
} as const;

export type ModelRateCatalogStatus =
	/** No file was there; the shipped artifact is now on disk, and recorded. */
	| "materialized"
	/** The file on disk was OUR untouched copy and the shipped artifact had moved on;
	 *  it was replaced and re-recorded. */
	| "updated"
	/** A file was already there and was left EXACTLY as it was, with nothing to say. */
	| "kept"
	/** A file was there whose bytes are NOT the ones we recorded writing — this node
	 *  corrected a rate. Left untouched; the shipped version is reported so the operator
	 *  can decide, and nothing decides for them. */
	| "edited"
	/** A file was there with NO usable provenance record — every node materialised before
	 *  this pattern existed is here. Left untouched, and reported as unknown rather than
	 *  guessed either way. */
	| "unknown"
	/** The shipped package could not be resolved — nothing written, and the host will
	 *  inject no catalog, which the guest reads as "prices unknown". */
	| "unresolved"
	/** Resolved but unwritable. Same consequence as `unresolved`, different cause. */
	| "failed";

export interface ModelRateCatalogMaterialization {
	status: ModelRateCatalogStatus;
	/** Where the host will look, whether or not anything was written. */
	path: string;
	/** `catalogVersion` of the file ON DISK after this pass. `null` when there is no
	 *  file, or it is not a readable catalog. */
	localCatalogVersion: string | null;
	/** `catalogVersion` of the SHIPPED artifact. `null` when it could not be resolved or
	 *  read. Compared against `localCatalogVersion`, this is the whole decision an
	 *  operator holding an edited catalog has to make. */
	shippedCatalogVersion: string | null;
	message?: string;
}

/** What the provenance record holds. Only `sha256` is load bearing for the decision; the
 *  rest is there so a human who opens the file learns something. */
interface ModelRateCatalogRecord {
	schemaVersion: string;
	/** The basename this record describes — an orphan record is self-explaining. */
	file: string;
	/** SHA-256 (hex) of the EXACT bytes this pass wrote. */
	sha256: string;
	catalogVersion: string | null;
	/** ISO-8601, in UTC. */
	writtenAt: string;
}

/** Where the host looks. `resolveRefarmHome()` IS the sovereign dir — the same resolution
 *  `refarm auth enroll` uses for `<REFARM_HOME>/auth-policy.json`, which the daemon derives
 *  from the `--refarm-dir` it is given. */
export function modelRateCatalogPath(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(resolveRefarmHome(env), MODEL_RATE_CATALOG_FILE_NAME);
}

/** Where the provenance record lives: beside the catalog it describes. */
export function modelRateCatalogRecordPath(env: NodeJS.ProcessEnv = process.env): string {
	return path.join(resolveRefarmHome(env), MODEL_RATE_CATALOG_RECORD_FILE_NAME);
}

function sha256Of(bytes: Buffer | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}

/** `catalogVersion` out of catalog bytes, or `null` for anything that is not a catalog.
 *  Never throws: a version we cannot read is reported as unknown, never as a failure. */
function readCatalogVersion(bytes: Buffer | string): string | null {
	try {
		const parsed = JSON.parse(String(bytes)) as { catalogVersion?: unknown };
		return typeof parsed.catalogVersion === "string" ? parsed.catalogVersion : null;
	} catch {
		return null;
	}
}

interface CatalogBytes {
	bytes: Buffer | string;
	sha256: string;
	catalogVersion: string | null;
}

/** Unique per call AND per process. The pid alone was not enough: two passes inside one
 *  process would have staged through the same name and the second would have written over
 *  the first's bytes before either moved. */
let stagedCounter = 0;
function stagedPath(target: string): string {
	stagedCounter += 1;
	return `${target}.${process.pid}.${stagedCounter}.tmp`;
}

/** The catalog currently on disk, or `null` when there is none. A file that exists but
 *  cannot be read is `null` too — the pass then treats it as absent and the create path's
 *  `link(2)` refuses to clobber it, which is the same answer by a safer route. */
function readCatalogOnDisk(target: string): CatalogBytes | null {
	if (!fs.existsSync(target)) return null;
	try {
		const bytes = fs.readFileSync(target);
		return { bytes, sha256: sha256Of(bytes), catalogVersion: readCatalogVersion(bytes) };
	} catch {
		return null;
	}
}

/** The shipped artifact, or the reason it is not available. */
function readShippedCatalog(): CatalogBytes | { error: string } {
	const resolution = resolvePluginPackage(MODEL_RATE_CATALOG_PACKAGE, {
		baseUrl: import.meta.url,
	});
	if (!resolution) {
		return {
			error: `package ${MODEL_RATE_CATALOG_PACKAGE.npmPackage} not found in node_modules or workspace`,
		};
	}
	const source = path.join(resolution.pkgDir, "catalog", MODEL_RATE_CATALOG_FILE_NAME);
	try {
		const bytes = fs.readFileSync(source);
		return { bytes, sha256: sha256Of(bytes), catalogVersion: readCatalogVersion(bytes) };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { error: `cannot read ${source}: ${message}` };
	}
}

/** The record, or `null` for absent, unreadable, wrong-schema, or missing-hash. Every
 *  `null` here lands on `unknown`, which keeps the file — so being strict costs a report
 *  line and never costs an operator their edit. */
function readRecord(recordPath: string): ModelRateCatalogRecord | null {
	try {
		const parsed = JSON.parse(fs.readFileSync(recordPath, "utf-8")) as Partial<
			Record<keyof ModelRateCatalogRecord, unknown>
		>;
		if (parsed.schemaVersion !== MODEL_RATE_CATALOG_RECORD_SCHEMA) return null;
		if (typeof parsed.sha256 !== "string" || parsed.sha256.length === 0) return null;
		return {
			schemaVersion: parsed.schemaVersion,
			file: typeof parsed.file === "string" ? parsed.file : MODEL_RATE_CATALOG_FILE_NAME,
			sha256: parsed.sha256,
			catalogVersion: typeof parsed.catalogVersion === "string" ? parsed.catalogVersion : null,
			writtenAt: typeof parsed.writtenAt === "string" ? parsed.writtenAt : "",
		};
	} catch {
		return null;
	}
}

/**
 * Record what we just put on disk. Staged and renamed like the catalog itself, so a torn
 * record is impossible rather than merely unlikely.
 *
 * Returns the failure instead of throwing, because a catalog that landed is still a
 * success — the report says the provenance could not be written, and the next pass reads
 * `unknown` and keeps the file. Failing the whole materialisation over the bookkeeping
 * would be the tail wagging the dog.
 */
function writeRecord(recordPath: string, written: CatalogBytes): string | null {
	const record: ModelRateCatalogRecord = {
		schemaVersion: MODEL_RATE_CATALOG_RECORD_SCHEMA,
		file: MODEL_RATE_CATALOG_FILE_NAME,
		sha256: written.sha256,
		catalogVersion: written.catalogVersion,
		writtenAt: new Date().toISOString(),
	};
	const staged = stagedPath(recordPath);
	try {
		fs.writeFileSync(staged, `${JSON.stringify(record, null, 2)}\n`);
		fs.renameSync(staged, recordPath);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	} finally {
		try {
			fs.rmSync(staged, { force: true });
		} catch {
			// The rename already moved it; nothing to clean and nothing to report.
		}
	}
}

/** Nothing on disk: stage the bytes and `link` them into place. */
function createCatalog(
	target: string,
	recordPath: string,
	shipped: CatalogBytes,
): ModelRateCatalogMaterialization {
	const staged = stagedPath(target);
	try {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(staged, shipped.bytes);
		try {
			// CREATE-IF-ABSENT, atomically. `rename` would clobber a file another process
			// wrote since the read above — and clobbering an unexamined file is the one
			// thing this must never do, because it could be a node's rate correction.
			fs.linkSync(staged, target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				// A concurrent pass won the race with the same shipped bytes, and wrote the
				// record too. Nothing to add.
				return {
					status: "kept",
					path: target,
					localCatalogVersion: shipped.catalogVersion,
					shippedCatalogVersion: shipped.catalogVersion,
					message: "another pass materialized the catalog first",
				};
			}
			throw error;
		}
		const recordError = writeRecord(recordPath, shipped);
		return {
			status: "materialized",
			path: target,
			localCatalogVersion: shipped.catalogVersion,
			shippedCatalogVersion: shipped.catalogVersion,
			...(recordError
				? {
						message: `catalog written, but its provenance record could not be (${recordError}) — the next pass will report it as unknown`,
					}
				: {}),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: "failed",
			path: target,
			localCatalogVersion: null,
			shippedCatalogVersion: shipped.catalogVersion,
			message,
		};
	} finally {
		try {
			fs.rmSync(staged, { force: true });
		} catch {
			// `link` kept the inode; losing the staged name is not a failure worth reporting.
		}
	}
}

/** Our own untouched copy is stale: stage the new bytes and `rename` over it. */
function replaceCatalog(
	target: string,
	recordPath: string,
	shipped: CatalogBytes,
	verified: CatalogBytes,
): ModelRateCatalogMaterialization {
	const staged = stagedPath(target);
	try {
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(staged, shipped.bytes);

		// Re-verify RIGHT BEFORE the move. Between classifying the file as ours and this
		// line, an operator (or another pass) may have written it. This narrows the window
		// where "never overwrite an edit" could be violated to a single syscall, and the
		// answer when it closes on us is to leave the file exactly where it is.
		const current = readCatalogOnDisk(target);
		if (!current || current.sha256 !== verified.sha256) {
			return {
				status: "kept",
				path: target,
				localCatalogVersion: current?.catalogVersion ?? null,
				shippedCatalogVersion: shipped.catalogVersion,
				message:
					"the catalog changed while this pass was staging its replacement — left untouched",
			};
		}

		// Atomic swap: a reader sees the old file or the new one, never a partial one.
		fs.renameSync(staged, target);
		const recordError = writeRecord(recordPath, shipped);
		return {
			status: "updated",
			path: target,
			localCatalogVersion: shipped.catalogVersion,
			shippedCatalogVersion: shipped.catalogVersion,
			message: recordError
				? `catalog updated from ${verified.catalogVersion ?? "an unversioned catalog"}, but its provenance record could not be written (${recordError}) — the next pass will report it as unknown`
				: `replaced this node's unmodified copy of ${verified.catalogVersion ?? "an unversioned catalog"}`,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			status: "failed",
			path: target,
			localCatalogVersion: verified.catalogVersion,
			shippedCatalogVersion: shipped.catalogVersion,
			message,
		};
	} finally {
		try {
			fs.rmSync(staged, { force: true });
		} catch {
			// The rename already consumed it.
		}
	}
}

/**
 * Bring the sovereign dir's rate catalog in line with the shipped artifact WITHOUT ever
 * destroying a correction this node made. See the four answers in the file header.
 *
 * Idempotent: once the shipped bytes are on disk and recorded, every later call reports
 * `kept` and touches nothing.
 *
 * Never throws.
 */
export function materializeDefaultModelRateCatalog(
	env: NodeJS.ProcessEnv = process.env,
): ModelRateCatalogMaterialization {
	const target = modelRateCatalogPath(env);
	const recordPath = modelRateCatalogRecordPath(env);
	const shipped = readShippedCatalog();
	const local = readCatalogOnDisk(target);

	// ── nothing on disk ───────────────────────────────────────────────────────────
	if (!local) {
		if ("error" in shipped) {
			return {
				status: "unresolved",
				path: target,
				localCatalogVersion: null,
				shippedCatalogVersion: null,
				message: shipped.error,
			};
		}
		return createCatalog(target, recordPath, shipped);
	}

	const shippedVersion = "error" in shipped ? null : shipped.catalogVersion;
	const record = readRecord(recordPath);

	// ── a file, but nothing says who wrote it ─────────────────────────────────────
	// The state every node materialised before this pattern existed is in. Not ours to
	// claim and not theirs to blame: keep it, name it, and name the way out.
	if (!record) {
		return {
			status: "unknown",
			path: target,
			localCatalogVersion: local.catalogVersion,
			shippedCatalogVersion: shippedVersion,
			message: `a catalog is present with no provenance record, so this pass cannot tell an untouched copy from a corrected one — keeping it (on disk: ${local.catalogVersion ?? "unversioned"}; shipped: ${shippedVersion ?? "unknown"}). If you never edited it, delete ${target} and run the pass again to adopt the shipped catalog; if you did, keep it and this stays the answer.`,
		};
	}

	// ── a file we did not write these bytes into ──────────────────────────────────
	// The rate correction case. Never overwritten, and never silently tolerated either:
	// the operator gets both versions and decides.
	if (record.sha256 !== local.sha256) {
		const behind = shippedVersion !== null && shippedVersion !== local.catalogVersion;
		return {
			status: "edited",
			path: target,
			localCatalogVersion: local.catalogVersion,
			shippedCatalogVersion: shippedVersion,
			message: behind
				? `this node edited its catalog, so it is kept as-is — but a newer catalog ships (${shippedVersion}) and this node is NOT using it (on disk: ${local.catalogVersion ?? "unversioned"}). To adopt it and lose the local edit, delete ${target} and run the pass again.`
				: `this node edited its catalog, so it is kept as-is (on disk: ${local.catalogVersion ?? "unversioned"}; shipped: ${shippedVersion ?? "unknown"}).`,
		};
	}

	// ── our own copy, untouched ───────────────────────────────────────────────────
	if ("error" in shipped) {
		return {
			status: "kept",
			path: target,
			localCatalogVersion: local.catalogVersion,
			shippedCatalogVersion: null,
			message: `${shipped.error} — the catalog on disk is kept, and this pass could not check whether it is current`,
		};
	}
	if (shipped.sha256 === local.sha256) {
		return {
			status: "kept",
			path: target,
			localCatalogVersion: local.catalogVersion,
			shippedCatalogVersion: shipped.catalogVersion,
		};
	}
	return replaceCatalog(target, recordPath, shipped, local);
}

/**
 * Lines for the human `plugin install` / `plugin update` output, and for whoever starts a
 * node. Silent ONLY on `kept`: "the file you already had is still the file you have" is
 * not news. Everything else is — a node quietly running last month's prices, or one
 * holding back an update it could take, is exactly what nobody found out about before.
 */
export function describeModelRateCatalog(
	result: ModelRateCatalogMaterialization,
): string | null {
	const version = result.localCatalogVersion ? ` (${result.localCatalogVersion})` : "";
	switch (result.status) {
		case "materialized":
			return `  ✓ model rate catalog materialized at ${result.path}${version}`;
		case "updated":
			return `  ✓ model rate catalog updated to ${result.shippedCatalogVersion ?? "the shipped catalog"} at ${result.path}`;
		case "kept":
			return null;
		// Both of these carry the whole explanation (and the way out) in `message`, so the
		// line names the file and then gets out of the way — a second summary in front of
		// it would only say the same thing twice.
		case "edited":
		case "unknown":
			return `  ! model rate catalog ${result.path}: ${result.message}`;
		case "unresolved":
		case "failed":
			return `  ✗ model rate catalog not materialized (${result.message}) — the runtime will price from the agent's built-in table`;
	}
}
