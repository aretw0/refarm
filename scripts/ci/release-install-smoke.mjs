#!/usr/bin/env node
/**
 * release-install-smoke — stretch the rope the release never stretched.
 *
 * The gap (docs/2026-07-25-v0.1.0-release-readiness.md, Rope #1/#2/#4):
 * `pnpm publish --dry-run` does NOT fail when a tarball ships no `dist/` or
 * depends on an unpublished package — so a release can pass every gate and still
 * break on `npm install`. This closes it end-to-end: for each selected package,
 * BUILD it, `pnpm pack` a REAL tarball, `pnpm install` those tarballs into a
 * throwaway consumer, and `import()` each entrypoint. If the tarball has no dist,
 * or a dep can't resolve, or the entrypoint won't load — this fails, loudly,
 * BEFORE the publish button.
 *
 * Usage:
 *   node scripts/ci/release-install-smoke.mjs                 # the 4 kernel contracts
 *   node scripts/ci/release-install-smoke.mjs packages/ds …   # explicit dirs
 *   node scripts/ci/release-install-smoke.mjs --selection consumer-ready
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildReleaseCheckPlan } from "../release-check.mjs";

// The smallest coherent 0.1.0 — the zero-runtime-dep kernel contracts.
const DEFAULT_PACKAGES = [
	"packages/storage-contract-v1",
	"packages/sync-contract-v1",
	"packages/identity-contract-v1",
	"packages/channel-policy-v1",
];

const repoRoot = process.cwd();

function parseArgs(argv) {
	const options = { selectionId: null, packageDirs: [] };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") continue;
		if (arg === "--selection") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--selection requires a value");
			}
			options.selectionId = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--")) {
			throw new Error(`Unknown argument: ${arg}`);
		}
		options.packageDirs.push(arg);
	}
	if (options.selectionId && options.packageDirs.length > 0) {
		throw new Error("Use either --selection or explicit package directories, not both");
	}
	return options;
}

function resolvePackageDirs(options) {
	if (!options.selectionId) {
		return options.packageDirs.length > 0 ? options.packageDirs : DEFAULT_PACKAGES;
	}
	const check = buildReleaseCheckPlan({
		cwd: repoRoot,
		selectionId: options.selectionId,
	});
	if (!check.ok) {
		throw new Error(`Release selection ${options.selectionId} is not accepted`);
	}
	return check.commands.map((command) => command.packageDir);
}

function assertInternalDependencyClosure(packageEntries) {
	const selectedNames = new Set(packageEntries.map((entry) => entry.pkg.name));
	const missing = [];
	for (const entry of packageEntries) {
		for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
			for (const [name, spec] of Object.entries(entry.pkg[section] ?? {})) {
				if (name.startsWith("@refarm.dev/") && !selectedNames.has(name)) {
					missing.push(`${entry.pkg.name} -> ${name} (${section}: ${spec})`);
				}
			}
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`Release install selection is not closed over internal dependencies:\n- ${missing.join("\n- ")}`,
		);
	}
}

const options = parseArgs(process.argv.slice(2));
const packageDirs = resolvePackageDirs(options);

function run(cmd, args, cwd) {
	try {
		return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
	} catch (error) {
		const detail = [error.stdout, error.stderr]
			.filter((value) => typeof value === "string" && value.trim().length > 0)
			.join("\n");
		throw new Error(`Command failed: ${cmd} ${args.join(" ")}${detail ? `\n${detail}` : ""}`, {
			cause: error,
		});
	}
}

function readPkg(dir) {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

// Build scripts the consumer approves, mirroring `allowBuilds` in the root pnpm-workspace.yaml.
const CONSUMER_ALLOW_BUILDS = { esbuild: true };

const stage = mkdtempSync(join(tmpdir(), "refarm-install-smoke-"));
const consumer = join(stage, "consumer");
mkdirSync(consumer, { recursive: true });
const packed = [];
try {
	const packageEntries = packageDirs.map((dir) => {
		const abs = resolve(repoRoot, dir);
		return { dir, abs, pkg: readPkg(abs) };
	});
	assertInternalDependencyClosure(packageEntries);

	// 1) build + pack a real tarball per package
	for (const { abs, pkg } of packageEntries) {
		process.stdout.write(`\n📦 ${pkg.name}\n`);
		if (pkg.scripts?.build) {
			process.stdout.write(`   building…\n`);
			run("pnpm", ["--filter", pkg.name, "run", "build"], repoRoot);
		}
		// Match the real publish lane: pnpm rewrites workspace: ranges to
		// publishable versions, while npm pack leaves workspace:* untouched.
		const beforePack = new Set(readdirSync(stage));
		run("pnpm", ["pack", "--pack-destination", stage], abs);
		const producedTarballs = readdirSync(stage).filter((name) => name.endsWith(".tgz") && !beforePack.has(name));
		if (producedTarballs.length !== 1) {
			throw new Error(`${pkg.name}: pnpm pack produced ${producedTarballs.length} tarballs instead of one`);
		}
		packed.push({ name: pkg.name, main: pkg.main ?? "index.js", tarball: resolve(stage, producedTarballs[0]) });
		process.stdout.write(`   packed ${producedTarballs[0]}\n`);
	}

	// 2) Install all tarballs into a clean pnpm consumer. Direct file specs do not
	// redirect transitive semver lookups, so the workspace overrides are part of
	// the proof: without them an unpublished support package would hit the registry.
	const fileSpecs = Object.fromEntries(
		packed.map((entry) => [
			entry.name,
			`file:${entry.tarball.replaceAll("\\", "/")}`,
		]),
	);
	writeFileSync(
		join(consumer, "package.json"),
		`${JSON.stringify({
			name: "install-smoke-consumer",
			private: true,
			type: "module",
			dependencies: fileSpecs,
		}, null, 2)}\n`,
	);
	writeFileSync(
		join(consumer, "pnpm-workspace.yaml"),
		[
			"packages:",
			'  - "."',
			"overrides:",
			...Object.entries(fileSpecs).map(([name, spec]) => `  "${name}": "${spec}"`),
			// pnpm 11 hard-errors (ERR_PNPM_IGNORED_BUILDS) on an unreviewed build script.
			// ds-astro → astro → esbuild carries one; the root pnpm-workspace.yaml approves
			// it, and a consumer following the same security line approves it too.
			"allowBuilds:",
			...Object.entries(CONSUMER_ALLOW_BUILDS).map(([name, allowed]) => `  ${name}: ${allowed}`),
			"",
		].join("\n"),
	);
	// The consumer lives in tmpdir, outside the repo, so the repo's .npmrc (public
	// registry over any corporate proxy in ~/.npmrc) would not apply — carry it over.
	if (existsSync(join(repoRoot, ".npmrc"))) {
		copyFileSync(join(repoRoot, ".npmrc"), join(consumer, ".npmrc"));
	}
	process.stdout.write(`\n⬇️  pnpm install (${packed.length} tarball(s))…\n`);
	run("pnpm", ["--store-dir", ".pnpm-store", "install", "--no-frozen-lockfile"], consumer);

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
	if (process.env.REFARM_RELEASE_SMOKE_KEEP === "1") {
		process.stderr.write(`Keeping release install-smoke stage for diagnosis: ${stage}\n`);
	} else {
		rmSync(stage, { recursive: true, force: true });
	}
}
