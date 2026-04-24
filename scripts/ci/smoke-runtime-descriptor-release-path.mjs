#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "./runtime-descriptor-cli.mjs";
import { runSubprocess } from "./subprocess-utils.mjs";

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const root = process.cwd();
	const sha = args.sha || process.env.GITHUB_SHA || "smoke";
	const tags =
		args.tags ||
		process.env.RUNTIME_DESCRIPTOR_SMOKE_TAGS ||
		"@refarm.dev/plugin-manifest@0.1.0";
	const outDir = path.resolve(
		root,
		args["out-dir"] || ".artifacts/runtime-descriptor-smoke",
	);

	await rm(outDir, { recursive: true, force: true });

	await runSubprocess(process.execPath, [
		"scripts/ci/export-runtime-descriptor-bundle.mjs",
		"--out-dir",
		outDir,
		"--version",
		sha,
	]);

	await runSubprocess(process.execPath, [
		"scripts/ci/publish-runtime-descriptor-release-assets.mjs",
		"--bundle-dir",
		outDir,
		"--sha",
		sha,
		"--tags",
		tags,
		"--dry-run",
	]);

	await runSubprocess("npm", [
		"--prefix",
		"packages/tractor-ts",
		"run",
		"test:unit",
		"--",
		"install-plugin",
		"browser-plugin-host",
		"runtime-descriptor-revocation-policy",
		"runtime-descriptor-revocation",
	]);

	console.log(
		"[runtime-descriptor-release-smoke] export + publish(dry-run) + resolver tests passed",
	);
}

main().catch((error) => {
	console.error(
		`[runtime-descriptor-release-smoke] failed: ${error?.message ?? error}`,
	);
	process.exit(1);
});
