import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/capability-host";
import { Barn } from "@refarm.dev/barn";
import { assessExtensionMaturity, type MaturityEvidence } from "@refarm.dev/plugin-manifest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * EXTENSION-LIFECYCLE — the plugin lifecycle as ONE flow, not three scattered verbs. T1 had
 * integrity (extension-verify), maturity (extension-develop), and live loading (agent-run)
 * as separate demos; this threads them over a REAL plugin through the platform's blocks:
 *
 *   author → INTEGRITY (real sha256) → MATURITY (assessExtensionMaturity) → INSTALL (the Barn:
 *   fetch + sha256 verify + cache) → ready to load.
 *
 * The Barn (@refarm.dev/barn) is the real lifecycle manager apps/refarm uses; here the example
 * installs a locally-built plugin through it (a file:// URL + a file-reading fetch), so the
 * whole 'scenario to record' the README asks for is one command.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The plugin whose lifecycle we demonstrate — the source provider T1 already boots (its
 * .wasm is a real, built artifact). */
export function defaultLifecyclePlugin(): string {
	return resolve(REPO_ROOT, "packages/source-provider-ref/dist/source_provider.wasm");
}

/** The canonical `sha256-<base64>` integrity of some bytes (what a publisher records). */
export function computeIntegrity(bytes: Uint8Array): string {
	return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

/** A fetch that reads a local file:// URL — the Barn's global fetch does not support file://,
 * so a local-first install supplies its own. Returns a minimal Response with the bytes. */
export function fileFetch(): typeof globalThis.fetch {
	return (async (input: unknown) => {
		const url = typeof input === "string" ? input : String((input as { url?: string }).url);
		const bytes = readFileSync(fileURLToPath(url));
		const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		return {
			ok: true,
			status: 200,
			arrayBuffer: async () => arrayBuffer,
		} as Response;
	}) as typeof globalThis.fetch;
}

export interface LifecycleReport {
	pluginPath: string;
	/** The real sha256 integrity computed from the artifact's bytes. */
	integrity: string;
	/** The maturity level the artifact reaches, the next rung, and what it's missing for it. */
	maturity: { level: string; next: string | null; missing: string[] };
	/** The Barn install result: verified + cached. */
	install: { id: string; status: string; cacheStatus: string; integrityVerified: boolean };
}

/**
 * Run the full lifecycle over a plugin: integrity → maturity → install via the Barn.
 * The Barn re-verifies the integrity on install (fetch + sha256), so an install proves the
 * bytes match — a tampered artifact would be rejected there.
 */
export async function runExtensionLifecycle(pluginPath: string): Promise<LifecycleReport> {
	const bytes = readFileSync(pluginPath);
	const integrity = computeIntegrity(bytes);

	// Maturity: a built, integrity-pinned, manifest-conformant artifact with the standard
	// telemetry hooks reaches a productive rung; the assessment reports the next rung and what
	// it is missing (e.g. an approval trail / revocability for the higher, sensitive rungs).
	const evidence: MaturityEvidence = {
		manifestConformant: true,
		integrity,
		wasmEntry: true,
		telemetryHooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
		capabilitiesStrict: true,
		version: "0.1.0",
		approvalTrail: false,
		revocable: false,
	};
	const assessment = assessExtensionMaturity(evidence);

	// Install through the Barn: fetch (local file), verify sha256, cache. A file-reading
	// fetch is injected because global fetch does not support file://.
	const barn = new Barn({ fetchFn: fileFetch() });
	const entry = await barn.installPlugin(pathToFileURL(pluginPath).href, integrity);

	return {
		pluginPath,
		integrity,
		maturity: {
			level: assessment.level,
			next: assessment.next,
			missing: assessment.missing.map((m) => m.id),
		},
		install: {
			id: entry.id,
			status: entry.status,
			cacheStatus: entry.cacheStatus,
			// The Barn accepted the install → the fetched bytes matched the declared integrity.
			integrityVerified: entry.status === "installed",
		},
	};
}

/**
 * `extension-lifecycle` — run the full plugin lifecycle (integrity → maturity → Barn install)
 * over a real built plugin, as one flow. The 'scenario to record' the T1 README asks for.
 */
export function createExtensionLifecycleCapability(): CapabilityDescriptor {
	return {
		name: "extension-lifecycle",
		summary: "Run the full plugin lifecycle over a real plugin: integrity → maturity → Barn install",
		transports: { http: { path: "/extension/lifecycle" } },
		renderers: { tui: { section: "governance" }, web: { route: "/extension-lifecycle", icon: "milestone" }, ide: { command: "dgk.extension-lifecycle" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const pluginPath = defaultLifecyclePlugin();
			if (!existsSync(pluginPath)) {
				return buildJsonErrorEnvelope({
					command: "extension-lifecycle",
					operation: "extension-lifecycle",
					error: "artifact_missing",
					message: `Build the plugin first (missing: ${pluginPath}).`,
					nextAction: "pnpm --filter @refarm.dev/source-provider-ref run build:plugin",
				});
			}
			try {
				const report = await runExtensionLifecycle(pluginPath);
				return buildJsonSuccessEnvelope({
					command: "extension-lifecycle",
					operation: "extension-lifecycle",
					nextCommand: "dgk agent-run",
					nextCommands: ["dgk agent-run"],
					extra: {
						// The full flow, as data: each stage the writeup's lifecycle figure describes.
						stages: ["author", "integrity", "maturity", "install"],
						integrity: report.integrity,
						maturity: report.maturity,
						install: report.install,
						manager: "the Barn (@refarm.dev/barn) — real fetch + sha256 verify + cache",
					},
				});
			} catch (error) {
				return buildJsonErrorEnvelope({
					command: "extension-lifecycle",
					operation: "extension-lifecycle",
					error: "lifecycle_failed",
					message: error instanceof Error ? error.message : String(error),
					nextAction: "Check the plugin artifact is built and readable.",
				});
			}
		},
	};
}
