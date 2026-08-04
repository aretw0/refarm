#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

function usage() {
	console.error("Usage: node scripts/ci/onboarding-doctor.mjs [--json] [--package <path|@scope/name>]");
}

export function parseArgs(argv) {
	const options = {
		json: false,
		packageRef: null,
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg === "--package") {
			const value = argv[i + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("--package requires a value");
			}
			options.packageRef = value;
			i += 1;
			continue;
		}
		throw new Error(`unknown argument: ${arg}`);
	}
	return options;
}

export function resolvePackageDir(root, packageRef) {
	if (!packageRef) return null;
	if (packageRef.startsWith("@refarm.dev/")) {
		return path.join(root, "packages", packageRef.replace("@refarm.dev/", ""));
	}
	if (packageRef.startsWith("packages/") || packageRef.startsWith("apps/")) {
		return path.join(root, packageRef);
	}
	if (packageRef.includes("/")) {
		return path.resolve(root, packageRef);
	}
	return path.join(root, "packages", packageRef);
}

function runNode(commandArgs) {
	return spawnSync(process.execPath, commandArgs, {
		cwd: ROOT,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function checkNodeSubstrate() {
	const result = runNode(["scripts/ci/check-node-substrate.mjs", "--json"]);
	if (result.status !== 0) {
		return {
			ok: false,
			exitCode: result.status ?? 1,
			stderr: result.stderr.trim(),
			stdout: result.stdout.trim(),
		};
	}
	try {
		const payload = JSON.parse(result.stdout);
		return {
			ok: payload.ok === true,
			exitCode: payload.ok ? 0 : 1,
			payload,
			stderr: result.stderr.trim(),
		};
	} catch (error) {
		return {
			ok: false,
			exitCode: 1,
			stderr: `invalid node-substrate JSON: ${error instanceof Error ? error.message : String(error)}`,
			stdout: result.stdout.trim(),
		};
	}
}

function checkPackageTsconfig(packageDir) {
	if (!packageDir) {
		return { ok: true, skipped: true, reason: "no package target" };
	}
	const tsconfigBuild = path.join(packageDir, "tsconfig.build.json");
	if (!existsSync(tsconfigBuild)) {
		return {
			ok: false,
			skipped: false,
			reason: `missing tsconfig.build.json in ${path.relative(ROOT, packageDir)}`,
		};
	}

	const tscPath = path.join(ROOT, "node_modules", "typescript", "lib", "tsc.js");
	if (!existsSync(tscPath)) {
		return {
			ok: false,
			skipped: false,
			reason: "missing workspace TypeScript compiler (node_modules/typescript/lib/tsc.js)",
		};
	}

	const configRaw = readFileSync(path.join(packageDir, "tsconfig.json"), "utf8");
	const usesWorkspaceTsconfigSpecifier = configRaw.includes("@refarm.dev/tsconfig/");
	const localTsconfigLink = path.join(packageDir, "node_modules", "@refarm.dev", "tsconfig", "buildable.json");
	const localLinkOk = !usesWorkspaceTsconfigSpecifier || existsSync(localTsconfigLink);

	const showConfig = runNode([
		tscPath,
		"-p",
		path.relative(ROOT, tsconfigBuild),
		"--showConfig",
	]);

	return {
		ok: showConfig.status === 0 && localLinkOk,
		skipped: false,
		packageDir: path.relative(ROOT, packageDir),
		showConfigExitCode: showConfig.status ?? 1,
		usesWorkspaceTsconfigSpecifier,
		localTsconfigLink,
		localTsconfigLinkOk: localLinkOk,
		stderr: showConfig.stderr.trim(),
	};
}

function buildReport(options) {
	const nodeSubstrate = checkNodeSubstrate();
	const packageDir = resolvePackageDir(ROOT, options.packageRef);
	const packageTsconfig = checkPackageTsconfig(packageDir);
	const checks = [
		{ id: "node-substrate", ok: nodeSubstrate.ok },
		{ id: "package-tsconfig", ok: packageTsconfig.ok },
	];
	const ok = checks.every((check) => check.ok);
	return {
		ok,
		command: "onboarding-doctor",
		operation: "check",
		packageRef: options.packageRef,
		packageDir: packageDir ? path.relative(ROOT, packageDir) : null,
		checks,
		nodeSubstrate,
		packageTsconfig,
		nextAction: ok
			? null
			: "Run node-substrate check first, then materialize workspace links for the target package and re-run onboarding doctor.",
		nextCommand: ok ? null : "node scripts/ci/check-node-substrate.mjs --json",
	};
}

function printHuman(report) {
	if (report.ok) {
		console.log("onboarding-doctor: OK");
		if (report.packageDir) {
			console.log(`  package tsconfig: OK (${report.packageDir})`);
		}
		return;
	}
	console.error("onboarding-doctor: FAIL");
	if (!report.nodeSubstrate.ok) {
		console.error("  - node substrate is not healthy");
	}
	if (!report.packageTsconfig.ok) {
		if (report.packageTsconfig.reason) {
			console.error(`  - package tsconfig: ${report.packageTsconfig.reason}`);
		} else if (report.packageTsconfig.localTsconfigLinkOk === false) {
			console.error(
				`  - package tsconfig link missing: ${report.packageTsconfig.localTsconfigLink}`,
			);
		} else {
			console.error(
				`  - package tsconfig showConfig failed (exit ${report.packageTsconfig.showConfigExitCode})`,
			);
		}
	}
	if (report.nextCommand) {
		console.error(`  next: ${report.nextCommand}`);
	}
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		usage();
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
		return;
	}

	const report = buildReport(options);
	if (options.json) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		printHuman(report);
	}
	if (!report.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	void main();
}
