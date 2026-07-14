import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type SurfaceableManifest,
} from "@refarm.dev/capability-host";
import { createReferenceChecker, type CheckerFinding, type CheckerProfile } from "@refarm.dev/quality-checker-ref";

/**
 * EXTENSION-QUALITY — a well-formedness / hygiene gate on an extension, run by a REAL
 * sandboxed WASM checker. It completes the governance quartet: integrity (extension-verify)
 * + maturity (extension-develop) + policy (governance-poc) + QUALITY (here). The checker is
 * the reference `quality:v1` component, loaded under a DENY-ALL capability table
 * (@refarm.dev/quality-checker-ref createReferenceChecker) — pure compute that cannot touch
 * fs/net. The manifest is serialised to a `text` subject; the rules are matcher-is-data
 * (`contains`), so a richer hygiene profile ships as rule DATA, never a contract change.
 */

/** The extension-hygiene profile: rules that flag risky/incomplete extension declarations.
 * Matcher-is-data — each rule's `check` is opaque JSON the sandboxed checker interprets. */
export const EXTENSION_HYGIENE_PROFILE: CheckerProfile = {
	name: "extension-hygiene",
	rules: [
		{
			id: "declares-high-risk-shell",
			severity: "warning",
			description: "The extension declares shell:spawn — a high-risk capability that should trigger human review before promotion.",
			check: JSON.stringify({ type: "contains", value: "shell:spawn" }),
		},
		{
			id: "declares-network",
			severity: "info",
			description: "The extension declares network:outbound — egress should be constrained to a declared allowlist.",
			check: JSON.stringify({ type: "contains", value: "network:outbound" }),
		},
		{
			id: "declares-fs-write",
			severity: "info",
			description: "The extension declares fs:write — controlled edits are fine, but note the write surface for review.",
			check: JSON.stringify({ type: "contains", value: "fs:write" }),
		},
	],
};

/** Serialise an extension manifest to the flat text the substring checker scans. Capability
 * ids appear verbatim so the hygiene rules can flag them. */
export function manifestToQualitySubject(manifest: SurfaceableManifest): string {
	const caps = manifest.capabilities ?? {};
	return [
		`id:${manifest.id}`,
		`provides:${(caps.provides ?? []).join(",")}`,
		`requires:${((caps as { requires?: string[] }).requires ?? []).join(",")}`,
		`subscribes:${(caps.subscribes ?? []).join(",")}`,
		`providesApi:${(caps.providesApi ?? []).join(",")}`,
		`requiresApi:${(caps.requiresApi ?? []).join(",")}`,
	].join("\n");
}

export interface ExtensionQualityReport {
	extension: string;
	findings: CheckerFinding[];
	/** A well-formed extension with no hygiene findings passes clean. */
	clean: boolean;
}

/**
 * Run the sandboxed quality checker over an extension manifest with the hygiene profile.
 * The checker is instantiated under the deny-all boundary — it sees only the subject text.
 */
export async function checkExtensionQuality(manifest: SurfaceableManifest): Promise<ExtensionQualityReport> {
	const checker = await createReferenceChecker();
	const findings = checker.check({ tag: "text", val: manifestToQualitySubject(manifest) }, EXTENSION_HYGIENE_PROFILE);
	return { extension: manifest.id, findings, clean: findings.length === 0 };
}

/**
 * `extension-quality` — run the sovereign quality:v1 WASM checker over the bench's extension
 * manifests with an extension-hygiene profile, reporting findings. The fourth governance
 * gate: a real sandboxed analysis of how the extension is declared.
 */
export function createExtensionQualityCapability(manifests: readonly SurfaceableManifest[]): CapabilityDescriptor {
	return {
		name: "extension-quality",
		summary: "Run the sovereign quality:v1 WASM checker over the extension manifests (a hygiene gate)",
		transports: { http: { path: "/extension/quality" } },
		renderers: { tui: { section: "governance" }, web: { route: "/extension-quality", icon: "verified" }, ide: { command: "dgk.extension-quality" } },
		async run(_input: CapabilityInput): Promise<CapabilityEnvelope> {
			const reports = await Promise.all(manifests.map((m) => checkExtensionQuality(m)));
			const totalFindings = reports.reduce((n, r) => n + r.findings.length, 0);
			return buildJsonSuccessEnvelope({
				command: "extension-quality",
				operation: "extension-quality",
				nextCommand: "dgk extension-verify",
				nextCommands: ["dgk extension-verify"],
				extra: {
					profile: EXTENSION_HYGIENE_PROFILE.name,
					checked: reports.length,
					totalFindings,
					reports: reports.map((r) => ({
						extension: r.extension,
						clean: r.clean,
						findings: r.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, message: f.message })),
					})),
					checker: "quality:v1 reference component, loaded under a deny-all sandbox (pure compute, no fs/net)",
				},
			});
		},
	};
}
