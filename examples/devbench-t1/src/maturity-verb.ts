import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
} from "@refarm.dev/capability-host";
import { assessExtensionMaturity, MATURITY_TRAIL, type MaturityEvidence } from "@refarm.dev/plugin-manifest";

/**
 * `extension-develop` — SIMULATE developing an extension through the governed maturity trail. This
 * is the "develop a plugin via the platform extension path" the T1 writeup describes: the same
 * extension is assessed as its evidence accrues — a bare experiment, then a productive extension
 * (conformant manifest + integrity + telemetry), then a sensitive-context one (WASM entry, strong
 * integrity, strict capabilities, full telemetry), then a catalog entry (versioned, approval trail,
 * revocable). At each stage the host CLASSIFIES it and reports what BLOCKS promotion — the objective
 * gate the writeup's maturity figure (Figura 3) shows.
 *
 * The maturity trail + assessment are the platform's (@refarm.dev/plugin-manifest); this example
 * only supplies the evidence a developer would accrue. It consumes the block, it doesn't invent it.
 */

/** The evidence an extension accrues as it is hardened — one snapshot per development stage. */
const DEVELOPMENT_STAGES: Array<{ stage: string; note: string; evidence: MaturityEvidence }> = [
	{
		stage: "1. Rascunho",
		note: "A extensão nasce como experimento — só um manifesto, atrito mínimo.",
		evidence: {},
	},
	{
		stage: "2. Endurecimento produtivo",
		note: "Manifesto conforme, integridade registrada, telemetria de ciclo de vida.",
		evidence: { manifestConformant: true, integrity: "pending", telemetryHooks: ["onLoad", "onError"] },
	},
	{
		stage: "3. Trilho WASM (contexto sensível)",
		note: "Compilada para componente WASM, integridade sha256 forte, capacidades estritas, telemetria completa.",
		evidence: {
			manifestConformant: true,
			integrity: "a".repeat(64),
			wasmEntry: true,
			capabilitiesStrict: true,
			telemetryHooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
		},
	},
	{
		stage: "4. Publicação no catálogo",
		note: "Versionada, com trilha de aprovação e política de revogação.",
		evidence: {
			manifestConformant: true,
			integrity: "a".repeat(64),
			wasmEntry: true,
			capabilitiesStrict: true,
			telemetryHooks: ["onLoad", "onInit", "onRequest", "onError", "onTeardown"],
			version: "1.0.0",
			approvalTrail: true,
			revocable: true,
		},
	},
];

/**
 * The verb: run the extension through its development stages and report the maturity progression —
 * the level reached at each stage + what blocked further promotion. Generates the Figura-3 evidence
 * (experiment → productive → sensitive → catalog) with objective criteria, verifiably.
 */
export function createExtensionDevelopCapability(): CapabilityDescriptor {
	return {
		name: "extension-develop",
		summary: "Simulate developing an extension through the governed maturity trail (experiment → catalog)",
		transports: { http: { path: "/extension/develop" } },
		renderers: { tui: { section: "governance" }, web: { route: "/maturity", icon: "milestone" }, ide: { command: "dgk.extension-develop" } },
		async run(): Promise<CapabilityEnvelope> {
			const progression = DEVELOPMENT_STAGES.map(({ stage, note, evidence }) => {
				const assessment = assessExtensionMaturity(evidence);
				return {
					stage,
					note,
					level: assessment.level,
					next: assessment.next,
					blockedBy: assessment.missing.map((m) => m.label),
				};
			});
			const reached = progression[progression.length - 1]!.level;
			return buildJsonSuccessEnvelope({
				command: "extension-develop",
				operation: "extension-develop",
				nextCommand: "dgk governance-poc",
				nextCommands: ["dgk governance-poc"],
				extra: {
					trail: MATURITY_TRAIL.map((s) => ({ level: s.level, label: s.label })),
					progression,
					reached,
					disclaimer: "Simulação local do ciclo de vida governado de uma extensão — critérios objetivos de promoção, sem implantação.",
				},
			});
		},
	};
}
