import { createFsAssetStore } from "@refarm.dev/asset-resolver-contract-v1/node";
import type { CapabilityDescriptor, CapabilityInput } from "@refarm.dev/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/capabilities/envelope";
import { scopedAssetsDir } from "@refarm.dev/storage-node-view";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRefarmHome } from "../utils/refarm-home.js";

import { detectEntryFormat, type PluginPolicyMode } from "@refarm.dev/plugin-manifest";
import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildExtensionReviewReport,
	loadReviewableManifest,
	type ExtensionReviewReport,
} from "./plugin-review-capability.js";
import { installedPluginDir, sentinelPath } from "./plugin-shared.js";

/**
 * Install a PREPARED, REVIEWED extension from a path — the missing link that
 * connects `extension review <path>` to an actual install. `buildInstallReport`
 * only ever installs the BUNDLED plugins (a fixed set), so the review→install
 * handoff was severed: `review` could approve an arbitrary path but nothing could
 * install it. This closes that loop, installing exactly the path that was reviewed.
 *
 * SAFETY — review-first, never bypass the gate. Install RE-RUNS the same policy
 * decision (`buildExtensionReviewReport`) with the operator's grants and refuses to
 * install unless it is `readyToInstall` (manifest valid + all required capabilities
 * granted). So `install` can never grant more than `review` showed — the exact same
 * decision governs both. An install with insufficient grants fails with the denied
 * capabilities, identical to review.
 */

// When a manifest declares no explicit `entry`, fall back to these conventional
// filenames beside it, in order. `.wasm` first for back-compat with the original
// WASM-only installer; a JS-entry plugin is expected to DECLARE its entry.
const ENTRY_FALLBACK_CANDIDATES = ["plugin.wasm", "plugin.js", "plugin.mjs", "plugin.cjs"] as const;

export interface ExtensionInstallInput {
	targetPath: string;
	grantedCapabilities: string[];
	policyMode: PluginPolicyMode;
	availableConnections?: string[];
	/**
	 * The command verb this install is projected under (ADR-086) — stamped into the
	 * envelope. Defaults to "extension" so the legacy `extension install` call-site
	 * is byte-identical; `plugin install <path>` passes "plugin".
	 */
	commandName?: "extension" | "plugin";
}

export type ExtensionInstallReport = JsonSuccessEnvelope<{
	pluginId: string;
	installedFrom: string;
	installedTo: string;
	integrity: string;
	bytes: number;
}>;

/** The resolved code entry of a plugin: its absolute source path, the destination
 * filename to preserve (so a `.js` entry lands as `plugin.js`, a `.wasm` as
 * `plugin.wasm`), and its detected format. */
interface ResolvedEntry {
	src: string;
	destName: string;
	format: ReturnType<typeof detectEntryFormat>;
}

/** Resolve a plugin's CODE entry beside its manifest — any supported format
 * (`js` / `mjs` / `cjs` / `wasm`), not just `.wasm`. Honors a `file://` or relative
 * `entry`; else falls back to conventional `plugin.<ext>` files. The destination
 * filename preserves the entry's own basename so the installed manifest points at
 * the right file. Returns null if no entry file exists. */
function resolveExtensionEntry(
	manifest: Record<string, unknown>,
	manifestPath: string,
): ResolvedEntry | null {
	const dir = path.dirname(manifestPath);
	const entry = typeof manifest.entry === "string" ? manifest.entry : undefined;
	if (entry) {
		const rel = entry.startsWith("file://") ? entry.slice("file://".length) : entry;
		const abs = path.isAbsolute(rel) ? rel : path.join(dir, rel);
		if (existsSync(abs)) {
			return { src: abs, destName: path.basename(abs), format: detectEntryFormat(abs) };
		}
	}
	for (const candidate of ENTRY_FALLBACK_CANDIDATES) {
		const abs = path.join(dir, candidate);
		if (existsSync(abs)) {
			return { src: abs, destName: candidate, format: detectEntryFormat(candidate) };
		}
	}
	return null;
}

/**
 * The pure install core: review the path, and if ready, install the reviewed
 * extension into the sovereign plugins dir (wasm + rewritten manifest +
 * content-addressed store + version sentinel), returning the envelope. No console
 * output, no process.exitCode — the envelope IS the report (the projector drives
 * exit from `ok`). Mirrors `installPlugin`'s copy/store/manifest steps, but sourced
 * from a reviewed PATH, not a resolved npm package.
 */
export async function buildExtensionInstallReport(
	input: ExtensionInstallInput,
): Promise<ExtensionInstallReport | ReturnType<typeof buildJsonErrorEnvelope>> {
	const commandName = input.commandName ?? "extension";
	// 1) Re-run the SAME policy decision — install-first is never review-bypass.
	//    The review is projected under the SAME verb so its handoffs match.
	let review: ExtensionReviewReport;
	try {
		review = buildExtensionReviewReport({ ...input, commandName });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "install",
			error: "extension_install_failed",
			message,
			nextAction: `Point --at a prepared extension directory or manifest; run \`${commandName} review\` first.`,
		});
	}
	if (!review.readyToInstall) {
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "install",
			error: "extension_not_ready",
			message: `Extension is not ready to install (${review.decision.status}). ${
				review.deniedCapabilities.length > 0
					? `Denied capabilities (not granted): ${review.deniedCapabilities.join(", ")}.`
					: review.missingConnections.length > 0
						? `Missing declared connections: ${review.missingConnections.join(", ")}.`
					: review.decision.manifestErrors.join("; ")
			}`,
			nextAction: `Review it and grant the required capabilities, then install: \`${commandName} review <path> --grant <cap>\`.`,
				extra: {
					pluginId: review.decision.pluginId,
					deniedCapabilities: review.deniedCapabilities,
					missingConnections: review.missingConnections,
				},
		});
	}

	// 2) Resolve the reviewed manifest + its code entry (any format — js/mjs/cjs/wasm,
	//    not just .wasm). The manifest already permits a JS entry (integrity is
	//    required only for .wasm; validate.js:198), so the installer is generic over
	//    the entry format — only .wasm's filename convention was ever WASM-specific.
	const { manifest: rawManifest, manifestPath } = loadReviewableManifest(input.targetPath);
	const manifest = rawManifest as Record<string, unknown>;
	const pluginId = review.decision.pluginId;
	const resolvedEntry = resolveExtensionEntry(manifest, manifestPath);
	if (!resolvedEntry) {
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "install",
			error: "extension_entry_missing",
			message: `No code entry found for ${pluginId} beside ${manifestPath} (looked at the manifest 'entry' and plugin.{wasm,js,mjs,cjs}).`,
			nextAction: "Ensure the prepared plugin ships its built entry (a .wasm or .js/.mjs/.cjs).",
		});
	}
	if (resolvedEntry.format === "unknown") {
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "install",
			error: "extension_entry_unsupported",
			message: `The entry for ${pluginId} (${path.basename(resolvedEntry.src)}) is not a supported plugin format (js, mjs, cjs, wasm).`,
			nextAction: "Ship the plugin with a supported code entry.",
		});
	}

	// 3) Install: copy the entry + rewrite the manifest into the plugins dir, store
	//    the bytes content-addressed, and write the version sentinel — the SAME
	//    on-disk shape a bundled install produces, so the runtime loads it identically.
	//    Format-agnostic: it operates on BYTES, keeping the entry's own basename.
	const entryBytes = readFileSync(resolvedEntry.src);
	const sha256 = createHash("sha256").update(entryBytes).digest("hex");
	const integrity = `sha256-${sha256}`;

	// Defense in depth: when the reviewed manifest DECLARES an integrity (required
	// for .wasm, optional for js), verify the bytes on disk still match — a tampered
	// artifact swapped in after review is rejected here, not silently installed.
	// (Compares the hex, case-insensitively, ignoring the sha256- / sha256: prefixes.)
	const declared = typeof manifest.integrity === "string" ? manifest.integrity : "";
	const declaredHex = declared.replace(/^sha256[-:]/i, "").toLowerCase();
	if (declaredHex && declaredHex !== sha256) {
		return buildJsonErrorEnvelope({
			command: commandName,
			operation: "install",
			error: "extension_integrity_mismatch",
			message: `The entry for ${pluginId} does not match the reviewed integrity (declared ${declared}, actual sha256-${sha256}). The artifact changed since review.`,
			nextAction: "Re-review the plugin; do not install a changed artifact.",
		});
	}

	const destDir = installedPluginDir(pluginId);
	await mkdir(destDir, { recursive: true });
	const destEntry = path.join(destDir, resolvedEntry.destName);
	copyFileSync(resolvedEntry.src, destEntry);

	// Content-addressed store (E2) — best-effort, never fatal (the file:// entry works
	// regardless), mirroring the bundled install path.
	try {
		// ISS-050: the DECLARED base, not the OS home. `scopedAssetsDir("user")` used to default its home
		// to os.homedir(), and this is the call site that proved the cost — confirmed on disk, an install
		// wrote the working tree's agent.wasm into the OPERATOR's real ~/.refarm/assets/ while a sandbox
		// home was declared. That is why HOME became the sandbox launcher's sixth isolated axis.
		const assetsHome = path.dirname(resolveRefarmHome());
		const stored = await createFsAssetStore(scopedAssetsDir("user", { userHome: assetsHome })).store(entryBytes);
		if (stored.hash !== sha256) {
			throw new Error(`content-store hash ${stored.hash} != install hash ${sha256}`);
		}
	} catch {
		// advisory: the file:// entry still loads.
	}

	const installedManifest = {
		...manifest,
		entry: `file://${destEntry}`,
		integrity,
	};
	await writeFile(
		path.join(destDir, "plugin.json"),
		JSON.stringify(installedManifest, null, 2) + "\n",
		"utf-8",
	);

	const sentinel = sentinelPath(pluginId);
	await mkdir(path.dirname(sentinel), { recursive: true });
	await writeFile(
		sentinel,
		typeof manifest.version === "string" ? manifest.version : "0.0.0",
		"utf-8",
	);

	return buildJsonSuccessEnvelope({
		command: commandName,
		operation: "install",
		nextCommand: "resume --json",
		nextCommands: ["resume --json"],
		extra: {
			pluginId,
			installedFrom: manifestPath,
			installedTo: destDir,
			integrity,
			bytes: entryBytes.byteLength,
		},
	});
}

function parsePolicyMode(value: unknown): PluginPolicyMode {
	if (value === undefined || value === "fail-fast") return "fail-fast";
	if (value === "warn+continue") return "warn+continue";
	throw new Error("--policy must be fail-fast or warn+continue");
}

/**
 * The `extension install` capability — declared once, projects to the CLI
 * `extension install <path>` sub-command and the REPL `/install` slash. run() is
 * pure over the builder; it re-reviews then installs, returning an envelope.
 */
export const extensionInstallCapability: CapabilityDescriptor = {
	name: "install",
	transports: { cli: { group: "extension" } },
	summary:
		"Install a reviewed extension from a path (re-runs the policy gate; installs only if ready)",
	args: [{ name: "path", required: true }],
	options: [
		{
			name: "grant",
			kind: "string[]",
			summary: "Grant a capability for this install (repeatable); default grants none",
		},
		{
			name: "policy",
			kind: "string",
			summary: "Policy mode: fail-fast or warn+continue",
			defaultValue: "fail-fast",
		},
	],
	async run(input: CapabilityInput) {
		try {
			return await buildExtensionInstallReport({
				targetPath: input.args.path as string,
				grantedCapabilities: (input.options.grant as string[]) ?? [],
				policyMode: parsePolicyMode(input.options.policy),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return buildJsonErrorEnvelope({
				command: "extension",
				operation: "install",
				error: "extension_install_failed",
				message,
				nextAction: "Run `extension install --help`.",
			});
		}
	},
};

/** CLI surface hooks: human text + exit intent for `extension install`. */
export const extensionInstallHooks: CapabilitySurfaceHooks = {
	renderText(envelope) {
		if (envelope.ok === false) {
			return `Extension install failed: ${(envelope as { message?: string }).message ?? "unknown error"}`;
		}
		const report = envelope as ExtensionInstallReport;
		return [
			`Installed ${report.pluginId} (${report.bytes} bytes)`,
			`  from: ${report.installedFrom}`,
			`  to:   ${report.installedTo}`,
			`  integrity: ${report.integrity}`,
		].join("\n");
	},
	exitCode(envelope) {
		return envelope.ok === false ? 1 : 0;
	},
};
