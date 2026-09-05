import {
	runQualityCheck,
	type QualityChecker,
	type QualityFinding,
	type QualityProfile,
	type QualityReport,
} from "@refarm.dev/quality-contract-v1";

export const SURFACE_QUALITY_PROFILE_VERSION = "surface-quality.v1" as const;
export const SURFACE_MODALITIES = ["web", "terminal", "chat"] as const;
export type SurfaceModality = (typeof SURFACE_MODALITIES)[number];

export interface SurfaceQualityEvidence {
	readonly id: string;
	readonly status: "pass" | "fail" | "not-applicable";
	/** Test, checker, fixture, or bounded reason that produced this conclusion. */
	readonly proof: string;
	readonly metrics?: Readonly<Record<string, string | number | boolean>>;
}

interface EvidenceCheck {
	type: "surface-evidence";
	evidenceId: string;
	allowNotApplicable?: boolean;
}

function rule(
	id: string,
	description: string,
	options: { allowNotApplicable?: boolean } = {},
): QualityProfile["rules"][number] {
	return {
		id,
		severity: "fail",
		description,
		category: "surface-quality",
		check: {
			type: "surface-evidence",
			evidenceId: id,
			...(options.allowNotApplicable ? { allowNotApplicable: true } : {}),
		} satisfies EvidenceCheck,
	};
}

const COMMON_RULES: QualityProfile["rules"] = [
	rule("locale-fallback", "The surface resolves a supported locale and has a tested fallback."),
	rule("primary-journey", "The primary operator journey is exercised end to end."),
	rule("visible-feedback", "Progress, success, refusal, and failure remain observable."),
	rule("non-color-meaning", "Meaning never depends on colour alone."),
	rule("consequential-review", "Consequential actions require an explicit review step.", {
		allowNotApplicable: true,
	}),
];

const MODALITY_RULES: Record<SurfaceModality, QualityProfile["rules"]> = {
	web: [
		rule("web-keyboard", "The primary journey is operable by keyboard."),
		rule("web-accessible-names", "Interactive controls expose programmatic names."),
		rule("web-status-announced", "Asynchronous status is announced to assistive technology."),
		rule("web-reflow", "Content remains usable at the supported narrow viewport."),
	],
	terminal: [
		rule("terminal-focus", "Focus order and movement are deterministic."),
		rule("terminal-width", "Content remains legible at the supported narrow terminal width."),
		rule("terminal-spacing", "Successive steps remain visually separable without clearing history."),
		rule("terminal-plain-status", "Status remains meaningful without colour or rich glyph support."),
	],
	chat: [
		rule("chat-action-labels", "Every remote action has a concise unambiguous label."),
		rule("chat-provider-limits", "Messages and action payloads stay inside provider limits."),
		rule("chat-stale-action", "Expired or foreign actions cannot settle current work."),
		rule("chat-acknowledgement", "A received interaction is acknowledged without indefinite busy state."),
	],
};

export function createSurfaceQualityProfile(modality: SurfaceModality): QualityProfile {
	return {
		name: `${SURFACE_QUALITY_PROFILE_VERSION}:${modality}`,
		modality,
		rules: [...COMMON_RULES, ...MODALITY_RULES[modality]],
	};
}

export function createSurfaceEvidenceChecker(): QualityChecker<readonly SurfaceQualityEvidence[]> {
	return {
		checkerId: "surface-evidence-v1",
		domain: "surface",
		check(subject, profile): QualityFinding[] {
			const findings: QualityFinding[] = [];
			const byId = new Map<string, SurfaceQualityEvidence>();
			const duplicates = new Set<string>();
			for (const evidence of subject) {
				if (byId.has(evidence.id)) duplicates.add(evidence.id);
				else byId.set(evidence.id, evidence);
			}
			for (const item of profile.rules) {
				const check = item.check as Partial<EvidenceCheck>;
				if (check.type !== "surface-evidence" || !check.evidenceId) continue;
				const evidence = byId.get(check.evidenceId);
				if (duplicates.has(check.evidenceId)) {
					findings.push(finding(item, "Evidence is ambiguous because its id is duplicated."));
				} else if (!evidence) {
					findings.push(finding(item, "Required evidence is missing."));
				} else if (!evidence.proof.trim()) {
					findings.push(finding(item, "Evidence must name the proof or bounded reason."));
				} else if (evidence.status === "fail") {
					findings.push(finding(item, evidence.proof));
				} else if (evidence.status === "not-applicable" && !check.allowNotApplicable) {
					findings.push(finding(item, `Not applicable is not allowed: ${evidence.proof}`));
				}
			}
			return findings;
		},
	};
}

function finding(rule: QualityProfile["rules"][number], message: string): QualityFinding {
	return { severity: rule.severity, ruleId: rule.id, message };
}

export function checkSurfaceQuality(
	modality: SurfaceModality,
	evidence: readonly SurfaceQualityEvidence[],
): Promise<QualityReport> {
	return runQualityCheck(createSurfaceEvidenceChecker(), evidence, createSurfaceQualityProfile(modality));
}
