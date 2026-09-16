#!/usr/bin/env node
/**
 * Prove the tarball a consumer actually receives: build → pack → clean install → import.
 * The consumer is disposable. The pnpm content-addressed store is deliberately reused,
 * so CI's normal cache accelerates this proof without weakening its clean resolution.
 *
 * Usage: release-install-smoke [--selection ID] [--json] [--keep]
 *        [--store-dir PATH] [--command-timeout-ms MS] [package-dir …]
 */
import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReleaseCheckPlan } from "../release-check.mjs";

const DEFAULT_PACKAGES = [
	"packages/storage-contract-v1",
	"packages/sync-contract-v1",
	"packages/identity-contract-v1",
	"packages/channel-policy-v1",
];
const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONSUMER_ALLOW_BUILDS = { esbuild: true };

function requireValue(argv, index, flag) {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
	return value;
}

export function parseArgs(argv) {
	const options = {
		commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
		json: false,
		keep: process.env.REFARM_RELEASE_SMOKE_KEEP === "1",
		packageDirs: [],
		selectionId: null,
		storeDir: process.env.REFARM_RELEASE_SMOKE_STORE_DIR ?? null,
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--") continue;
		if (arg === "--selection") {
			options.selectionId = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--store-dir") {
			options.storeDir = requireValue(argv, index, arg);
			index += 1;
			continue;
		}
		if (arg === "--command-timeout-ms") {
			const value = Number(requireValue(argv, index, arg));
			if (!Number.isSafeInteger(value) || value <= 0)
				throw new Error("--command-timeout-ms requires a positive integer");
			options.commandTimeoutMs = value;
			index += 1;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--keep") {
			options.keep = true;
			continue;
		}
		if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
		options.packageDirs.push(arg);
	}
	if (options.selectionId && options.packageDirs.length > 0)
		throw new Error("Use either --selection or explicit package directories, not both");
	return options;
}

export function resolvePackageDirs(options) {
	if (!options.selectionId)
		return options.packageDirs.length > 0 ? options.packageDirs : DEFAULT_PACKAGES;
	const check = buildReleaseCheckPlan({ cwd: repoRoot, selectionId: options.selectionId });
	if (!check.ok) throw new Error(`Release selection ${options.selectionId} is not accepted`);
	return check.commands.map((command) => command.packageDir);
}

export function assertInternalDependencyClosure(packageEntries) {
	const selectedNames = new Set(packageEntries.map((entry) => entry.pkg.name));
	const missing = [];
	for (const entry of packageEntries) {
		for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
			for (const [name, spec] of Object.entries(entry.pkg[section] ?? {})) {
				if (name.startsWith("@refarm.dev/") && !selectedNames.has(name))
					missing.push(`${entry.pkg.name} -> ${name} (${section}: ${spec})`);
			}
		}
	}
	if (missing.length > 0)
		throw new Error(
			`Release install selection is not closed over internal dependencies:\n- ${missing.join("\n- ")}`,
		);
}

function readPkg(dir) {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}
function elapsedMs(startedAt) {
	return Math.round(performance.now() - startedAt);
}
function formatDuration(ms) {
	return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}
function log(options, message) {
	if (!options.json) process.stdout.write(`${message}\n`);
}

function run(command, args, cwd, { commandTimeoutMs }) {
	const startedAt = performance.now();
	try {
		execFileSync(command, args, {
			cwd,
			encoding: "utf8",
			maxBuffer: 32 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
			timeout: commandTimeoutMs,
			windowsHide: true,
		});
		return { elapsedMs: elapsedMs(startedAt) };
	} catch (error) {
		const detail = [error.stdout, error.stderr]
			.filter((value) => typeof value === "string" && value.trim().length > 0)
			.join("\n");
		const timeout = error.code === "ETIMEDOUT" ? ` after ${commandTimeoutMs}ms` : "";
		throw new Error(
			`Command failed${timeout}: ${command} ${args.join(" ")}${detail ? `\n${detail}` : ""}`,
			{ cause: error },
		);
	}
}

function installArgs(options) {
	const args = ["install", "--no-frozen-lockfile"];
	if (options.storeDir) args.unshift("--store-dir", resolve(repoRoot, options.storeDir));
	return args;
}

export function serializeReport({ options, packageResults, phaseTimings, results, stage }) {
	return {
		command: "release-install-smoke",
		ok: results.every((result) => result.ok),
		packages: results,
		packageTimings: packageResults,
		phasesMs: phaseTimings,
		selectionId: options.selectionId,
		stage: options.keep ? stage : null,
		storeDir: options.storeDir ? resolve(repoRoot, options.storeDir) : "pnpm-configured-store",
	};
}

async function main(options) {
	const startedAt = performance.now();
	const phaseTimings = {};
	const packageResults = [];
	const stage = mkdtempSync(join(tmpdir(), "refarm-install-smoke-"));
	const consumer = join(stage, "consumer");
	mkdirSync(consumer, { recursive: true });
	const packed = [];
	try {
		const packageEntries = resolvePackageDirs(options).map((dir) => ({
			dir,
			abs: resolve(repoRoot, dir),
			pkg: readPkg(resolve(repoRoot, dir)),
		}));
		assertInternalDependencyClosure(packageEntries);
		const buildAndPackStartedAt = performance.now();
		for (const [index, { abs, pkg }] of packageEntries.entries()) {
			const packageStartedAt = performance.now();
			const timing = { name: pkg.name, buildMs: 0, packMs: 0 };
			log(options, `\n📦 [${index + 1}/${packageEntries.length}] ${pkg.name}`);
			if (pkg.scripts?.build) {
				log(options, "   building…");
				timing.buildMs = run(
					"pnpm",
					["--filter", pkg.name, "run", "build"],
					repoRoot,
					options,
				).elapsedMs;
			}
			const beforePack = new Set(readdirSync(stage));
			timing.packMs = run("pnpm", ["pack", "--pack-destination", stage], abs, options).elapsedMs;
			const producedTarballs = readdirSync(stage).filter(
				(name) => name.endsWith(".tgz") && !beforePack.has(name),
			);
			if (producedTarballs.length !== 1)
				throw new Error(
					`${pkg.name}: pnpm pack produced ${producedTarballs.length} tarballs instead of one`,
				);
			packed.push({
				name: pkg.name,
				main: pkg.main ?? "index.js",
				tarball: resolve(stage, producedTarballs[0]),
			});
			timing.totalMs = elapsedMs(packageStartedAt);
			packageResults.push(timing);
			log(options, `   packed ${producedTarballs[0]} (${formatDuration(timing.totalMs)})`);
		}
		phaseTimings.buildAndPackMs = elapsedMs(buildAndPackStartedAt);
		const fileSpecs = Object.fromEntries(
			packed.map((entry) => [entry.name, `file:${entry.tarball.replaceAll("\\", "/")}`]),
		);
		writeFileSync(
			join(consumer, "package.json"),
			`${JSON.stringify({ name: "install-smoke-consumer", private: true, type: "module", dependencies: fileSpecs }, null, 2)}\n`,
		);
		writeFileSync(
			join(consumer, "pnpm-workspace.yaml"),
			[
				"packages:",
				'  - "."',
				"overrides:",
				...Object.entries(fileSpecs).map(([name, spec]) => `  "${name}": "${spec}"`),
				"allowBuilds:",
				...Object.entries(CONSUMER_ALLOW_BUILDS).map(([name, allowed]) => `  ${name}: ${allowed}`),
				"",
			].join("\n"),
		);
		if (existsSync(join(repoRoot, ".npmrc")))
			copyFileSync(join(repoRoot, ".npmrc"), join(consumer, ".npmrc"));
		log(options, `\n⬇️  pnpm install (${packed.length} tarball(s), reusable store)…`);
		const installStartedAt = performance.now();
		run("pnpm", installArgs(options), consumer, options);
		phaseTimings.installMs = elapsedMs(installStartedAt);
		const importStartedAt = performance.now();
		const results = [];
		for (const p of packed) {
			const entry = join(consumer, "node_modules", ...p.name.split("/"), p.main);
			try {
				const mod = await import(pathToFileURL(entry).href);
				results.push({
					name: p.name,
					ok: Object.keys(mod).length > 0,
					exports: Object.keys(mod).length,
				});
			} catch (error) {
				results.push({
					name: p.name,
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}
		phaseTimings.importMs = elapsedMs(importStartedAt);
		phaseTimings.totalMs = elapsedMs(startedAt);
		const report = serializeReport({ options, packageResults, phaseTimings, results, stage });
		if (options.json) process.stdout.write(`${JSON.stringify(report)}\n`);
		else {
			process.stdout.write("\n── install-and-import ──\n");
			for (const result of results)
				process.stdout.write(
					result.ok
						? `  ✅ ${result.name} — installed + imported (${result.exports} exports)\n`
						: `  ❌ ${result.name} — ${result.error ?? "no exports"}\n`,
				);
			process.stdout.write(
				`\n${report.ok ? "✅" : "❌"} ${results.length} package(s) in ${formatDuration(phaseTimings.totalMs)} (build+pack ${formatDuration(phaseTimings.buildAndPackMs)}, install ${formatDuration(phaseTimings.installMs)}, import ${formatDuration(phaseTimings.importMs)}).\n`,
			);
		}
		if (!report.ok)
			throw new Error(
				"release-install-smoke FAILED — a tarball would break on consumer install or import",
			);
		return report;
	} finally {
		if (options.keep)
			process.stderr.write(`Keeping release install-smoke stage for diagnosis: ${stage}\n`);
		else rmSync(stage, { recursive: true, force: true });
	}
}

function isMain() {
	return process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}
if (isMain()) {
	const options = parseArgs(process.argv.slice(2));
	main(options).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		if (options.json)
			process.stdout.write(
				`${JSON.stringify({ command: "release-install-smoke", ok: false, error: message })}\n`,
			);
		else process.stderr.write(`\n❌ ${message}\n`);
		process.exitCode = 1;
	});
}
