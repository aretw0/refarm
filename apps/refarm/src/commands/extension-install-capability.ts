import type {
	CapabilityDescriptor,
	CapabilityInput,
} from "@refarm.dev/cli/capabilities";
import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type JsonSuccessEnvelope,
} from "@refarm.dev/cli/json-output";
import { createFsAssetStore } from "@refarm.dev/asset-resolver-contract-v1/node";
import { scopedAssetsDir } from "@refarm.dev/storage-node-view";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CapabilitySurfaceHooks } from "./capability-commander.js";
import {
	buildExtensionReviewReport,
	loadReviewableManifest,
	type ExtensionReviewReport,
} from "./extension-review-capability.js";
import type { PluginPolicyMode } from "@refarm.dev/plugin-manifest";
import {
	pluginsBaseDir,
	pluginIdToFsToken,
	sentinelPath,
} from "./plugin-shared.js";

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

const WASM_ENTRY_CANDIDATES = ["plugin.wasm"] as const;

export interface ExtensionInstallInput {
	targetPath: string;
	grantedCapabilities: string[];
	policyMode: PluginPolicyMode;
}

export type ExtensionInstallReport = JsonSuccessEnvelope<{
	pluginId: string;
	installedFrom: string;
	installedTo: string;
	integrity: string;
	bytes: number;
}>;

/** Resolve the extension's `.wasm` beside its manifest: honor a `file://` or
 * relative `entry` in the manifest, else fall back to a conventional plugin.wasm in
 * the same directory. Returns the absolute wasm path, or null if none exists. */
function resolveExtensionWasm(
	manifest: Record<string, unknown>,
	manifestPath: string,
): string | null {
	const dir = path.dirname(manifestPath);
	const entry = typeof manifest.entry === "string" ? manifest.entry : undefined;
	if (entry) {
		const rel = entry.startsWith("file://") ? entry.slice("file://".length) : entry;
		const abs = path.isAbsolute(rel) ? rel : path.join(dir, rel);
		if (existsSync(abs)) return abs;
	}
	for (const candidate of WASM_ENTRY_CANDIDATES) {
		const abs = path.join(dir, candidate);
		if (existsSync(abs)) return abs;
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
	// 1) Re-run the SAME policy decision — install-first is never review-bypass.
	let review: ExtensionReviewReport;
	try {
		review = buildExtensionReviewReport(input);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return buildJsonErrorEnvelope({
			command: "extension",
			operation: "install",
			error: "extension_install_failed",
			message,
			nextAction:
				"Point --at a prepared extension directory or manifest; run `extension review` first.",
		});
	}
	if (!review.readyToInstall) {
		return buildJsonErrorEnvelope({
			command: "extension",
			operation: "install",
			error: "extension_not_ready",
			message: `Extension is not ready to install (${review.decision.status}). ${
				review.deniedCapabilities.length > 0
					? `Denied capabilities (not granted): ${review.deniedCapabilities.join(", ")}.`
					: review.decision.manifestErrors.join("; ")
			}`,
			nextAction:
				"Review it and grant the required capabilities, then install: `extension review <path> --grant <cap>`.",
			extra: {
				pluginId: review.decision.pluginId,
				deniedCapabilities: review.deniedCapabilities,
			},
		});
	}

	// 2) Resolve the reviewed manifest + its wasm.
	const { manifest: rawManifest, manifestPath } = loadReviewableManifest(
		input.targetPath,
	);
	const manifest = rawManifest as Record<string, unknown>;
	const pluginId = review.decision.pluginId;
	const wasmSrc = resolveExtensionWasm(manifest, manifestPath);
	if (!wasmSrc) {
		return buildJsonErrorEnvelope({
			command: "extension",
			operation: "install",
			error: "extension_wasm_missing",
			message: `No .wasm found for ${pluginId} beside ${manifestPath} (looked at the manifest 'entry' and plugin.wasm).`,
			nextAction: "Ensure the prepared extension ships its built .wasm.",
		});
	}

	// 3) Install: copy the wasm + rewrite the manifest into the plugins dir, store
	//    the bytes content-addressed, and write the version sentinel — the SAME
	//    on-disk shape a bundled install produces, so the runtime loads it identically.
	const wasmBytes = readFileSync(wasmSrc);
	const sha256 = createHash("sha256").update(wasmBytes).digest("hex");
	const integrity = `sha256-${sha256}`;

	// Defense in depth: a reviewed manifest DECLARES the wasm's integrity (a .wasm
	// entry is invalid without it, so review already required it). Verify the bytes
	// on disk still match — a tampered .wasm swapped in after review is rejected here,
	// not silently installed. (Compares the hex, case-insensitively, ignoring the
	// sha256- / sha256: prefix variants.)
	const declared = typeof manifest.integrity === "string" ? manifest.integrity : "";
	const declaredHex = declared.replace(/^sha256[-:]/i, "").toLowerCase();
	if (declaredHex && declaredHex !== sha256) {
		return buildJsonErrorEnvelope({
			command: "extension",
			operation: "install",
			error: "extension_integrity_mismatch",
			message: `The .wasm for ${pluginId} does not match the reviewed integrity (declared ${declared}, actual sha256-${sha256}). The artifact changed since review.`,
			nextAction: "Re-review the extension; do not install a changed artifact.",
		});
	}

	const destDir = path.join(pluginsBaseDir(), pluginIdToFsToken(pluginId));
	await mkdir(destDir, { recursive: true });
	copyFileSync(wasmSrc, path.join(destDir, "plugin.wasm"));

	// Content-addressed store (E2) — best-effort, never fatal (the file:// entry works
	// regardless), mirroring the bundled install path.
	try {
		const stored = await createFsAssetStore(scopedAssetsDir("user")).store(wasmBytes);
		if (stored.hash !== sha256) {
			throw new Error(`content-store hash ${stored.hash} != install hash ${sha256}`);
		}
	} catch {
		// advisory: the file:// entry still loads.
	}

	const installedManifest = {
		...manifest,
		entry: `file://${path.join(destDir, "plugin.wasm")}`,
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
		command: "extension",
		operation: "install",
		nextCommand: "resume --json",
		nextCommands: ["resume --json"],
		extra: {
			pluginId,
			installedFrom: manifestPath,
			installedTo: destDir,
			integrity,
			bytes: wasmBytes.byteLength,
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
			summary:
				"Grant a capability for this install (repeatable); default grants none",
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
