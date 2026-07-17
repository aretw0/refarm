#!/usr/bin/env node
import { rm } from "node:fs/promises";
import path from "node:path";
import { packageBinaryCommand } from "../../packages/config/src/package-manager.js";
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
	const keepArtifacts =
		args["keep-artifacts"] === true ||
		args["keep-artifacts"] === "true";

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

	// Ensure tractor-ts's workspace dependencies are built. The resolver tests below run vitest
	// inside packages/tractor-ts, which imports `@refarm.dev/registry` (and siblings) as workspace
	// packages resolved via their built dist (reso PUBLISHED/dist mode). In CI this smoke now runs
	// AFTER the Verify build step, but Verify builds FILTERED (--filter=...[base]) and so does not
	// guarantee a transitive dependency like @refarm.dev/registry is built for a tractor-rs-only
	// change — so the smoke still makes its own deps explicit here (a warm cache-hit after Verify).
	// Self-contained: it never fails with "Failed to resolve entry for package @refarm.dev/registry"
	// no matter what the surrounding build did.
	const buildCommand = packageBinaryCommand("turbo", [
		"run",
		"build",
		// packages/tractor-ts publishes as @refarm.dev/tractor (ADR-048 rename); building it pulls
		// its whole workspace dependency graph (registry, storage, …) so their dist exists for the
		// vitest resolver below.
		"--filter=@refarm.dev/tractor",
		"--output-logs=errors-only",
	]);
	await runSubprocess(buildCommand.command, buildCommand.args, { cwd: root });

	// Use the package-manager binary runner so patterns are passed directly to
	// vitest as positional file-name filters.
	const vitestCommand = packageBinaryCommand(
		"vitest",
		[
			"run",
			"--passWithNoTests",
			"install-plugin",
			"browser-plugin-host",
			"runtime-descriptor-revocation-policy",
			"runtime-descriptor-revocation",
		],
		{ cwd: path.join(root, "packages/tractor-ts") },
	);
	await runSubprocess(vitestCommand.command, vitestCommand.args, {
		cwd: path.join(root, "packages/tractor-ts"),
	});

	console.log(
		"[runtime-descriptor-release-smoke] export + publish(dry-run) + resolver tests passed",
	);

	if (!keepArtifacts) {
		await rm(outDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	console.error(
		`[runtime-descriptor-release-smoke] failed: ${error?.message ?? error}`,
	);
	process.exit(1);
});
