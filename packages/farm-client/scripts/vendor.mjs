#!/usr/bin/env node
/**
 * vendor — the kit CARRIES the blocks it reuses; it does not reimplement them.
 *
 * `packages/farm-client` is zero-dependency so it runs on a phone with nothing
 * but Node. That means nothing to INSTALL — it does not mean nothing to REUSE.
 * A block with zero dependencies of its own, importing only `node:` built-ins,
 * has built output that can travel inside the kit as a plain `.mjs` file,
 * distributed by `farm-update` like any other kit file (manifest entry + sha256
 * integrity).
 *
 * Two blocks travel today:
 *   @refarm.dev/prompt-contract-v1     — how the kit ASKS (readline, cancellation)
 *   @refarm.dev/operation-consent-v1   — how the kit asks for AUTHORISATION to
 *                                        change a file, and remembers the answer
 *
 * The risk of carrying a copy is DRIFT — a vendored file that silently stops
 * being the block. This module is the single answer to that:
 *
 *   node scripts/vendor.mjs            # sync: copy the built blocks into vendor/
 *   node scripts/vendor.mjs --check    # verify: byte-identical, or exit 1
 *
 * and `test/vendor.test.mjs` runs the same `checkVendor()` on every test run, so
 * a copy cannot drift without a red test. When a block's `dist/` is absent (it is
 * gitignored — an artifact) the check BUILDS it rather than skipping: a drift
 * check that quietly passes when it cannot look is not a check.
 *
 * Dev-only tooling: `scripts/` is not in package.json `files`, so it never ships
 * to a device. The kit's own runtime imports only the files under `vendor/`.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** One carried block: where its build lands, and where the copy lives. */
function block(name, file) {
	const blockDir = join(KIT_DIR, "..", name);
	return {
		block: `@refarm.dev/${name}`,
		blockDir,
		sourcePath: join(blockDir, "dist", "index.js"),
		vendorPath: join(KIT_DIR, "vendor", file),
		vendorFile: `vendor/${file}`,
		buildCommand: `pnpm --filter @refarm.dev/${name} run build`,
	};
}

/** Every block the kit carries. Adding one here is the whole registration. */
export const VENDORED_BLOCKS = [
	block("prompt-contract-v1", "prompt-contract-v1.mjs"),
	block("operation-consent-v1", "operation-consent-v1.mjs"),
];

/** The first block, kept as a named export so existing callers/tests read naturally. */
export const VENDORED = VENDORED_BLOCKS[0];

/** Build a block, so a missing artifact never turns the drift check into a
 *  skip. Uses the package's own tsc — no turbo, no pnpm resolution needed.
 *
 *  The `.tsbuildinfo` is dropped first: an incremental build whose dist was
 *  deleted underneath it exits 0 and emits NOTHING, which would leave the drift
 *  check reporting "missing" for a block that is perfectly buildable. */
async function buildBlock(target) {
	for (const entry of await readdir(target.blockDir)) {
		if (entry.endsWith(".tsbuildinfo")) {
			await rm(join(target.blockDir, entry), { force: true });
		}
	}
	const tsc = join(target.blockDir, "node_modules", ".bin", "tsc");
	execFileSync(tsc, ["--project", "tsconfig.build.json"], {
		cwd: target.blockDir,
		stdio: "pipe",
	});
}

/** A block's built bytes, building once if the artifact is not there yet.
 *  Throws — loudly, with the command to run — when it cannot be produced. */
export async function readBuiltBlock(target = VENDORED) {
	try {
		return await readFile(target.sourcePath);
	} catch {
		// fall through to the build attempt
	}
	try {
		await buildBlock(target);
	} catch (error) {
		throw new Error(
			`vendor: ${target.block} is not built and could not be built here ` +
				`(${error instanceof Error ? error.message.split("\n")[0] : String(error)}).\n` +
				`   Run: ${target.buildCommand}`,
		);
	}
	try {
		return await readFile(target.sourcePath);
	} catch {
		throw new Error(
			`vendor: ${target.block} built but produced no ${target.sourcePath}.\n` +
				`   Run: ${target.buildCommand}`,
		);
	}
}

/** A block's vendored bytes, or null when the copy is absent. */
export async function readVendoredBlock(target = VENDORED) {
	try {
		return await readFile(target.vendorPath);
	} catch {
		return null;
	}
}

/**
 * Is ONE vendored copy still THE BLOCK? Byte-identical or nothing.
 * Returns `{ ok, reason, detail }` — never throws for a mismatch, so callers
 * (CLI, test) decide how loud to be.
 */
export async function checkVendor(target = VENDORED) {
	const built = await readBuiltBlock(target);
	const vendored = await readVendoredBlock(target);
	if (vendored === null) {
		return { ok: false, reason: "missing", detail: `${target.vendorPath} does not exist` };
	}
	if (!built.equals(vendored)) {
		return {
			ok: false,
			reason: "drift",
			detail:
				`${target.vendorPath} is not the built ${target.block}\n` +
				`   built:    ${built.length} bytes\n` +
				`   vendored: ${vendored.length} bytes`,
		};
	}
	return { ok: true, reason: "identical", detail: `${built.length} bytes` };
}

/** Every carried block, checked. `{ ok, results: [{ target, ...verdict }] }`. */
export async function checkAllVendored() {
	const results = [];
	for (const target of VENDORED_BLOCKS) {
		results.push({ target, ...(await checkVendor(target)) });
	}
	return { ok: results.every((r) => r.ok), results };
}

/** Copy one built block into the kit. Returns the byte count written. */
export async function syncVendor(target = VENDORED) {
	const built = await readBuiltBlock(target);
	await mkdir(dirname(target.vendorPath), { recursive: true });
	await copyFile(target.sourcePath, target.vendorPath);
	return built.length;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const check = process.argv.includes("--check");
	if (check) {
		const { ok, results } = await checkAllVendored();
		for (const result of results) {
			if (result.ok) {
				process.stdout.write(`✔ ${result.target.vendorFile} is the built block (${result.detail})\n`);
			} else {
				process.stderr.write(`❌ vendor drift (${result.reason}): ${result.detail}\n`);
			}
		}
		if (!ok) {
			process.stderr.write(`   Fix: node scripts/vendor.mjs\n`);
			process.exit(1);
		}
	} else {
		for (const target of VENDORED_BLOCKS) {
			const bytes = await syncVendor(target);
			process.stdout.write(`✔ vendored ${target.block} → ${target.vendorFile} (${bytes} bytes)\n`);
		}
	}
}
