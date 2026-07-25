#!/usr/bin/env node
/**
 * release-install-smoke — stretch the rope the release never stretched.
 *
 * The gap (docs/2026-07-25-v0.1.0-release-readiness.md, Rope #1/#2/#4):
 * `pnpm publish --dry-run` does NOT fail when a tarball ships no `dist/` or
 * depends on an unpublished package — so a release can pass every gate and still
 * break on `npm install`. This closes it end-to-end: for each selected package,
 * BUILD it, `npm pack` a REAL tarball, `npm install` those tarballs into a
 * throwaway consumer, and `import()` each entrypoint. If the tarball has no dist,
 * or a dep can't resolve, or the entrypoint won't load — this fails, loudly,
 * BEFORE the publish button.
 *
 * Usage:
 *   node scripts/ci/release-install-smoke.mjs                 # the 4 kernel contracts
 *   node scripts/ci/release-install-smoke.mjs packages/ds …   # explicit dirs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// The smallest coherent 0.1.0 — the zero-runtime-dep kernel contracts.
const DEFAULT_PACKAGES = [
	"packages/storage-contract-v1",
	"packages/sync-contract-v1",
	"packages/identity-contract-v1",
	"packages/channel-policy-v1",
];

const repoRoot = process.cwd();
const packageDirs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_PACKAGES;

function run(cmd, args, cwd) {
	return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function readPkg(dir) {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

const stage = mkdtempSync(join(tmpdir(), "refarm-install-smoke-"));
const consumer = join(stage, "consumer");
mkdirSync(consumer, { recursive: true });
writeFileSync(
	join(consumer, "package.json"),
	`${JSON.stringify({ name: "install-smoke-consumer", private: true, type: "module" }, null, 2)}\n`,
);

const packed = [];
try {
	// 1) build + pack a real tarball per package
	for (const dir of packageDirs) {
		const abs = resolve(repoRoot, dir);
		const pkg = readPkg(abs);
		process.stdout.write(`\n📦 ${pkg.name}\n`);
		if (pkg.scripts?.build) {
			process.stdout.write(`   building…\n`);
			run("pnpm", ["--filter", pkg.name, "run", "build"], repoRoot);
		}
		const out = run("npm", ["pack", "--pack-destination", stage], abs);
		const tarball = out.trim().split("\n").pop().trim();
		packed.push({ name: pkg.name, main: pkg.main ?? "index.js", tarball: join(stage, tarball) });
		process.stdout.write(`   packed ${tarball}\n`);
	}

	// 2) install ALL tarballs into the throwaway consumer (a dep that can't resolve fails HERE)
	process.stdout.write(`\n⬇️  npm install (${packed.length} tarball(s))…\n`);
	run("npm", ["install", "--no-save", "--no-audit", "--no-fund", ...packed.map((p) => p.tarball)], consumer);

	// 3) import each entrypoint from the INSTALLED package (a missing dist fails HERE)
	const results = [];
	for (const p of packed) {
		const entry = join(consumer, "node_modules", ...p.name.split("/"), p.main);
		try {
			const mod = await import(pathToFileURL(entry).href);
			const exports = Object.keys(mod).length;
			results.push({ name: p.name, ok: exports > 0, exports });
		} catch (error) {
			results.push({ name: p.name, ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	}

	process.stdout.write(`\n── install-and-import ──\n`);
	let allOk = true;
	for (const r of results) {
		if (r.ok) {
			process.stdout.write(`  ✅ ${r.name} — installed + imported (${r.exports} exports)\n`);
		} else {
			allOk = false;
			process.stdout.write(`  ❌ ${r.name} — ${r.error ?? "no exports (empty/missing dist?)"}\n`);
		}
	}
	if (!allOk) {
		process.stderr.write(`\n❌ release-install-smoke FAILED — a tarball would break on npm install.\n`);
		process.exit(1);
	}
	process.stdout.write(`\n✅ all ${results.length} package(s) pack → install → import cleanly.\n`);
} finally {
	rmSync(stage, { recursive: true, force: true });
}
