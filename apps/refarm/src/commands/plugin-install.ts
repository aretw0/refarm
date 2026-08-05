import { createFsAssetStore } from "@refarm.dev/asset-resolver-contract-v1/node";
import { resolvePluginPackage } from "@refarm.dev/barn";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import { RUNTIME_AGENT_PLUGIN_DESCRIPTOR } from "@refarm.dev/config/plugin-identity";
import { scopedAssetsDir } from "@refarm.dev/storage-node-view";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	describeModelRateCatalog,
	materializeDefaultModelRateCatalog,
} from "./model-rate-catalog.js";
import { createPackageScriptCommand } from "./package-manager.js";
import {
	PLUGIN_INSTALL_COMMAND,
	PLUGIN_INSTALL_JSON_COMMAND,
	PLUGIN_STATUS_JSON_COMMAND,
} from "./plugin-handoffs.js";
import {
	BUNDLED_PLUGINS,
	type BundledPlugin,
	installedPluginDir,
	installedPluginWasmPath,
	type PluginInstallReport,
	type PluginInstallResult,
	readInstalledVersion,
	readPackageVersion,
	sentinelPath,
} from "./plugin-shared.js";

function localRuntimeAgentBuildCommand(): string {
	const runtimeAgentWorkspaceDir = RUNTIME_AGENT_PLUGIN_DESCRIPTOR.workspaceDir;
	return createPackageScriptCommand({
		cwd: runtimeAgentWorkspaceDir,
		script: "build",
	}).display;
}

export async function installedBundleIsCurrent(
	plugin: BundledPlugin,
	version: string,
	integrity: string,
): Promise<boolean> {
	const installed = await readInstalledVersion(plugin.id);
	if (installed !== version) return false;

	try {
		const manifestPath = path.join(installedPluginDir(plugin.id), "plugin.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
			integrity?: unknown;
			capabilities?: { provides?: unknown };
		};
		if (manifest.integrity !== integrity) return false;
		const requiredProvides = "requiredProvides" in plugin ? plugin.requiredProvides : [];
		if (requiredProvides.length === 0) return true;
		const provides = Array.isArray(manifest.capabilities?.provides)
			? manifest.capabilities.provides
			: [];
		return requiredProvides.every((capability) => provides.includes(capability));
	} catch {
		return false;
	}
}

export async function installPlugin(
	plugin: BundledPlugin,
	force: boolean,
	options: { quiet?: boolean } = {},
): Promise<PluginInstallResult> {
	const quiet = options.quiet === true;
	const resolution = resolvePluginPackage(plugin, { baseUrl: import.meta.url });
	if (!resolution) {
		const message = `package ${plugin.npmPackage} not found in node_modules or workspace`;
		if (!quiet) console.error(`  ✗ ${plugin.id}: ${message}`);
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: null,
			packageSource: "unresolved",
			message,
		};
	}
	const { pkgDir } = resolution;

	const pkgVersion = readPackageVersion(pkgDir);
	if (!pkgVersion) {
		const message = "cannot read package version";
		if (!quiet) console.error(`  ✗ ${plugin.id}: ${message}`);
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: null,
			packageSource: resolution.source,
			packageDir: pkgDir,
			message,
		};
	}

	const wasmSrc = path.join(pkgDir, plugin.wasmFile);
	if (!existsSync(wasmSrc)) {
		const buildCommand = localRuntimeAgentBuildCommand();
		const message = `WASM not found at ${wasmSrc}`;
		if (!quiet) {
			console.error(`  ✗ ${plugin.id}: ${message}`);
			console.error(`    Build first: ${buildCommand}`);
		}
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: pkgVersion,
			packageSource: resolution.source,
			packageDir: pkgDir,
			message,
			buildCommand,
		};
	}

	try {
		const wasmBytes = readFileSync(wasmSrc);
		const sha256 = createHash("sha256").update(wasmBytes).digest("hex");
		const integrity = `sha256-${sha256}`;

		if (!force && (await installedBundleIsCurrent(plugin, pkgVersion, integrity))) {
			const message = "already up-to-date";
			if (!quiet) console.log(`  ✓ ${plugin.id} v${pkgVersion} ${message}`);
			return {
				id: plugin.id,
				packageName: plugin.npmPackage,
				status: "cached",
				version: pkgVersion,
				packageSource: resolution.source,
				packageDir: pkgDir,
				message,
			};
		}

		// The one function that names an install directory — the same one
		// scripts/tractor-start.sh asks (through scripts/installed-plugin-path.mjs) for the
		// path it loads. Two spellings of this is exactly the defect this converged.
		const destDir = installedPluginDir(plugin.id);
		await mkdir(destDir, { recursive: true });

		copyFileSync(wasmSrc, installedPluginWasmPath(plugin.id));

		// E2: also store the .wasm in the content-addressed store keyed by its hash
		// (<user>/.refarm/assets/<sha256>), mirroring how skills persist their bytes.
		// The install's `integrity` (sha256-<hash>) is now a resolvable content-address:
		// a device with a replicated grant for this plugin (by hash) can materialize the
		// bytes from the store, verify them, and load — closing the id↔hash drift locally.
		// Idempotent (same content → same address); dedup for free. Never fatal to the
		// install: the file:// entry still works even if the content-store write fails.
		try {
			const stored = await createFsAssetStore(scopedAssetsDir("user")).store(wasmBytes);
			if (stored.hash !== sha256) {
				// Defensive: the store re-hashes; a mismatch means something is very wrong.
				throw new Error(`content-store hash ${stored.hash} != install hash ${sha256}`);
			}
		} catch (storeErr) {
			if (!quiet) {
				const msg = storeErr instanceof Error ? storeErr.message : String(storeErr);
				console.error(`    (content-store write skipped for ${plugin.id}: ${msg})`);
			}
		}

		const template = JSON.parse(
			readFileSync(path.join(pkgDir, plugin.manifestFile), "utf-8"),
		) as Record<string, unknown>;
		const manifest = {
			...template,
			entry: `file://${installedPluginWasmPath(plugin.id)}`,
			integrity,
		};
		await writeFile(
			path.join(destDir, "plugin.json"),
			JSON.stringify(manifest, null, 2) + "\n",
			"utf-8",
		);

		const sentinel = sentinelPath(plugin.id);
		await mkdir(path.dirname(sentinel), { recursive: true });
		await writeFile(sentinel, pkgVersion, "utf-8");

		if (!quiet) {
			console.log(
				`  ✓ ${plugin.id} v${pkgVersion} installed from ${resolution.source} (${wasmBytes.byteLength} bytes)`,
			);
		}
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "installed",
			version: pkgVersion,
			packageSource: resolution.source,
			packageDir: pkgDir,
			bytes: wasmBytes.byteLength,
			integrity,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (!quiet) console.error(`  ✗ ${plugin.id}: ${message}`);
		return {
			id: plugin.id,
			packageName: plugin.npmPackage,
			status: "failed",
			version: pkgVersion,
			packageSource: resolution.source,
			packageDir: pkgDir,
			message,
		};
	}
}

/**
 * Install the bundled plugins and RETURN the byte-stable install envelope — the
 * pure core the CapabilityGroup's `install`/`update` run() return directly, and
 * the legacy command prints. No console output, no process.exitCode: the envelope
 * IS the report (`ok:false` drives the projector's exit-1). Extracted so the one
 * envelope shape has a single source (never duplicated across the group + legacy).
 */
export async function buildInstallReport(options: {
	force?: boolean;
	/**
	 * The bundled set to install (ADR-086 white-label seam). Defaults to refarm's
	 * `BUNDLED_PLUGINS`; a white-label app passes ITS OWN descriptors so
	 * `plugin install --bundled` syncs the app's plugins, not refarm's. The
	 * per-descriptor install (`installPlugin`) is already origin-neutral — only the
	 * list was fixed.
	 */
	bundled?: readonly BundledPlugin[];
}): Promise<PluginInstallReport> {
	const bundled = options.bundled ?? BUNDLED_PLUGINS;
	const results: PluginInstallResult[] = [];
	for (const plugin of bundled) {
		results.push(await installPlugin(plugin, options.force === true, { quiet: true }));
	}

	// The runtime's rate catalog rides the same pass, for the same reason the plugins do:
	// it is a shipped npm artifact the sovereign dir must carry before the daemon starts.
	// It is NOT a plugin and never fails the install — a node without one still runs,
	// pricing from the agent's built-in table. See ./model-rate-catalog.ts.
	const modelRateCatalog = materializeDefaultModelRateCatalog();

	const failed = results.filter((result) => result.status === "failed").length;
	const failedResult = results.find((result) => result.status === "failed");
	return failedResult
		? buildJsonErrorEnvelope({
				command: "plugin",
				operation: "install",
				error: "plugin-install-failed",
				message: failedResult.message,
				nextAction: failedResult.buildCommand ?? PLUGIN_INSTALL_COMMAND,
				nextCommand: failedResult.buildCommand ?? PLUGIN_INSTALL_JSON_COMMAND,
				nextCommands: [
					...(failedResult.buildCommand ? [failedResult.buildCommand] : []),
					PLUGIN_INSTALL_JSON_COMMAND,
					PLUGIN_STATUS_JSON_COMMAND,
				],
				extra: { failed, plugins: results, modelRateCatalog },
			})
		: buildJsonSuccessEnvelope({
				command: "plugin",
				operation: "install",
				nextCommand: PLUGIN_STATUS_JSON_COMMAND,
				nextCommands: [PLUGIN_STATUS_JSON_COMMAND],
				extra: { failed, plugins: results, modelRateCatalog },
			});
}

export async function installBundledPlugins(options: {
	force?: boolean;
	json?: boolean;
	heading?: string;
}): Promise<void> {
	if (!options.json && options.heading) {
		console.log(options.heading);
	}

	// The pure report runs the install loop with quiet:true. For the non-json human
	// path we still want per-plugin progress, so re-run only in that mode.
	if (options.json) {
		const report = await buildInstallReport({ force: options.force });
		printJson(report);
		if (!report.ok) process.exitCode = 1;
		return;
	}

	const results: PluginInstallResult[] = [];
	for (const plugin of BUNDLED_PLUGINS) {
		results.push(await installPlugin(plugin, options.force === true, { quiet: false }));
	}
	// Same step the JSON path takes inside buildInstallReport — said out loud here, because
	// the human path narrates each artifact it puts in the sovereign dir.
	const catalogLine = describeModelRateCatalog(materializeDefaultModelRateCatalog());
	if (catalogLine) console.log(catalogLine);
	const failed = results.filter((result) => result.status === "failed").length;
	if (failed > 0) process.exitCode = 1;
}
