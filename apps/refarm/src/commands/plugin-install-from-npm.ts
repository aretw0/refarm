import { resolvePluginPackage } from "@refarm.dev/barn";
import { buildJsonErrorEnvelope } from "@refarm.dev/capabilities/envelope";
import type { PluginPolicyMode } from "@refarm.dev/plugin-manifest";
import { existsSync } from "node:fs";
import path from "node:path";

import {
	buildExtensionInstallReport,
	type ExtensionInstallReport,
} from "./plugin-install-from-path.js";

/**
 * Install a plugin from an `npm` reference (ADR-086 Fase 7b) — `plugin install
 * @scope/pkg` or `plugin install left-pad`. A resolved npm package is just a
 * directory that ships a `plugin.json` + its `.wasm`; so an npm install is: resolve
 * the package to its directory, locate its manifest, then run the SAME review-first
 * local installer (`buildExtensionInstallReport`). npm gains the identical safety as
 * a local install — the review gate (manifest valid + required capabilities
 * granted) and the integrity check on the wasm bytes.
 *
 * SCOPE (pragmatic, like the `url` wire): this resolves a package that is ALREADY
 * present (a workspace package or an installed dependency in node_modules — exactly
 * what the bundled install uses via `resolvePluginPackage`). A package that is NOT
 * present fails LOUDLY with an actionable message ("add it as a dependency, then
 * retry") rather than shelling out to a stateful `npm install` from inside the
 * command. Fetching-from-registry is a separate, heavier follow-on.
 */

/** Where a package's `plugin.json` may live, relative to the resolved package dir.
 * A conventional plugin ships it at the package root or under `dist/` (the built
 * output, as the bundled agent does: `dist/plugin.json`). */
const MANIFEST_DIR_CANDIDATES = [".", "dist"] as const;
const MANIFEST_FILENAMES = ["plugin.json", "ext.json"] as const;

export interface NpmInstallInput {
	/** The npm package reference (an `@scope/name` or a bare package name). */
	ref: string;
	grantedCapabilities: string[];
	policyMode: PluginPolicyMode;
	/** Resolution base (defaults to this module) — injected in tests. */
	baseUrl?: string;
	/** Workspace cwd for workspace-package resolution (defaults to process.cwd()). */
	cwd?: string;
}

/** Find the directory inside a resolved package that contains a reviewable
 * manifest (`plugin.json`/`ext.json`) — the package root or its `dist/`. */
function findManifestDir(pkgDir: string): string | null {
	for (const rel of MANIFEST_DIR_CANDIDATES) {
		const dir = path.join(pkgDir, rel);
		if (MANIFEST_FILENAMES.some((name) => existsSync(path.join(dir, name)))) {
			return dir;
		}
	}
	return null;
}

export async function buildNpmInstallReport(
	input: NpmInstallInput,
): Promise<ExtensionInstallReport | ReturnType<typeof buildJsonErrorEnvelope>> {
	// 1) Resolve the package to a directory (node_modules or workspace). Not
	//    present ⇒ loud, actionable failure — never a silent no-op or a stateful
	//    registry fetch from inside the command.
	const resolution = resolvePluginPackage(
		{ npmPackage: input.ref },
		{ baseUrl: input.baseUrl ?? import.meta.url, cwd: input.cwd },
	);
	if (!resolution) {
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "npm_package_not_resolved",
			message: `The npm package "${input.ref}" is not installed. Add it as a dependency (e.g. \`pnpm add ${input.ref}\`) and retry.`,
			nextAction: `Add ${input.ref} to the workspace, then run \`refarm plugin install ${input.ref}\`.`,
			extra: { ref: input.ref },
		});
	}

	// 2) Locate the package's plugin manifest (root or dist/).
	const manifestDir = findManifestDir(resolution.pkgDir);
	if (!manifestDir) {
		return buildJsonErrorEnvelope({
			command: "plugin",
			operation: "install",
			error: "npm_manifest_not_found",
			message: `The npm package "${input.ref}" (${resolution.pkgDir}) does not ship a plugin.json (looked at the package root and dist/). It may need building, or it is not a Refarm plugin.`,
			nextAction: "Build the package's plugin artifacts, or check it is a Refarm plugin.",
			extra: { ref: input.ref, packageDir: resolution.pkgDir },
		});
	}

	// 3) Delegate to the review-first local installer pointed at the resolved dir —
	//    the SAME gate (review + grants + integrity) a local install runs, so npm
	//    can never install more than review shows.
	return buildExtensionInstallReport({
		targetPath: manifestDir,
		grantedCapabilities: input.grantedCapabilities,
		policyMode: input.policyMode,
		commandName: "plugin",
	});
}
