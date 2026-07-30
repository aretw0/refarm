#!/usr/bin/env node
/**
 * vendor — the kit CARRIES the prompt block; it does not reimplement it.
 *
 * `packages/farm-client` is zero-dependency so it runs on a phone with nothing
 * but Node. That means nothing to INSTALL — it does not mean nothing to REUSE.
 * `@refarm.dev/prompt-contract-v1` has zero dependencies of its own and imports
 * exactly one thing (`node:readline`), so its built output can travel inside the
 * kit as a plain `.mjs` file, distributed by `farm-update` like any other kit
 * file (manifest entry + sha256 integrity).
 *
 * The risk of carrying a copy is DRIFT — a vendored file that silently stops
 * being the block. This module is the single answer to that:
 *
 *   node scripts/vendor.mjs            # sync: copy the built block into vendor/
 *   node scripts/vendor.mjs --check    # verify: byte-identical, or exit 1
 *
 * and `test/vendor.test.mjs` runs the same `checkVendor()` on every test run, so
 * the copy cannot drift without a red test. When the block's `dist/` is absent
 * (it is gitignored — an artifact) the check BUILDS it rather than skipping: a
 * drift check that quietly passes when it cannot look is not a check.
 *
 * Dev-only tooling: `scripts/` is not in package.json `files`, so it never ships
 * to a device. The kit's own runtime imports only `vendor/prompt-contract-v1.mjs`.
 */
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The block this kit carries: where its build lands, and where the copy lives. */
export const VENDORED = {
	block: "@refarm.dev/prompt-contract-v1",
	blockDir: join(KIT_DIR, "..", "prompt-contract-v1"),
	sourcePath: join(KIT_DIR, "..", "prompt-contract-v1", "dist", "index.js"),
	vendorPath: join(KIT_DIR, "vendor", "prompt-contract-v1.mjs"),
	buildCommand: "pnpm --filter @refarm.dev/prompt-contract-v1 run build",
};

/** Build the block, so a missing artifact never turns the drift check into a
 *  skip. Uses the package's own tsc — no turbo, no pnpm resolution needed.
 *
 *  The `.tsbuildinfo` is dropped first: an incremental build whose dist was
 *  deleted underneath it exits 0 and emits NOTHING, which would leave the drift
 *  check reporting "missing" for a block that is perfectly buildable. */
async function buildBlock() {
	for (const entry of await readdir(VENDORED.blockDir)) {
		if (entry.endsWith(".tsbuildinfo")) {
			await rm(join(VENDORED.blockDir, entry), { force: true });
		}
	}
	const tsc = join(VENDORED.blockDir, "node_modules", ".bin", "tsc");
	execFileSync(tsc, ["--project", "tsconfig.build.json"], {
		cwd: VENDORED.blockDir,
		stdio: "pipe",
	});
}

/** The block's built bytes, building once if the artifact is not there yet.
 *  Throws — loudly, with the command to run — when it cannot be produced. */
export async function readBuiltBlock() {
	try {
		return await readFile(VENDORED.sourcePath);
	} catch {
		// fall through to the build attempt
	}
	try {
		await buildBlock();
	} catch (error) {
		throw new Error(
			`vendor: ${VENDORED.block} is not built and could not be built here ` +
				`(${error instanceof Error ? error.message.split("\n")[0] : String(error)}).\n` +
				`   Run: ${VENDORED.buildCommand}`,
		);
	}
	try {
		return await readFile(VENDORED.sourcePath);
	} catch {
		throw new Error(
			`vendor: ${VENDORED.block} built but produced no ${VENDORED.sourcePath}.\n` +
				`   Run: ${VENDORED.buildCommand}`,
		);
	}
}

/** The vendored copy's bytes, or null when it is absent. */
export async function readVendoredBlock() {
	try {
		return await readFile(VENDORED.vendorPath);
	} catch {
		return null;
	}
}

/**
 * Is the vendored copy still THE BLOCK? Byte-identical or nothing.
 * Returns `{ ok, reason, detail }` — never throws for a mismatch, so callers
 * (CLI, test) decide how loud to be.
 */
export async function checkVendor() {
	const built = await readBuiltBlock();
	const vendored = await readVendoredBlock();
	if (vendored === null) {
		return { ok: false, reason: "missing", detail: `${VENDORED.vendorPath} does not exist` };
	}
	if (!built.equals(vendored)) {
		return {
			ok: false,
			reason: "drift",
			detail:
				`${VENDORED.vendorPath} is not the built ${VENDORED.block}\n` +
				`   built:    ${built.length} bytes\n` +
				`   vendored: ${vendored.length} bytes`,
		};
	}
	return { ok: true, reason: "identical", detail: `${built.length} bytes` };
}

/** Copy the built block into the kit. Returns the byte count written. */
export async function syncVendor() {
	const built = await readBuiltBlock();
	await mkdir(dirname(VENDORED.vendorPath), { recursive: true });
	await copyFile(VENDORED.sourcePath, VENDORED.vendorPath);
	return built.length;
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const check = process.argv.includes("--check");
	if (check) {
		const result = await checkVendor();
		if (!result.ok) {
			process.stderr.write(`❌ vendor drift (${result.reason}): ${result.detail}\n`);
			process.stderr.write(`   Fix: node scripts/vendor.mjs\n`);
			process.exit(1);
		}
		process.stdout.write(`✔ vendor/prompt-contract-v1.mjs is the built block (${result.detail})\n`);
	} else {
		const bytes = await syncVendor();
		process.stdout.write(`✔ vendored ${VENDORED.block} → vendor/prompt-contract-v1.mjs (${bytes} bytes)\n`);
	}
}
