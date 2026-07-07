import {
	buildJsonSuccessEnvelope,
	createRecordsCapabilityGroup,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type RecordsCommandDeps,
} from "@refarm.dev/capabilities-v1";

/**
 * The T3 PERSONA extension — "the analyst's requirements area", presented in RESULT
 * mode. This is level-3, work-specific (it carries the "requirements"/MOC vocabulary),
 * and it EXPOSES the generic engine as a finished PRODUCT: the analyst runs one verb
 * and gets a navigable Map of Content over their requirements — they never see the
 * neutral `records analyze` machinery underneath.
 *
 * The genericism stays honest: this reads the SAME neutral grouping envelope
 * (`records analyze`) that any surface reads, and projects it into the persona's
 * artifact (a requirements MOC in markdown). A different work would switch THIS
 * extension out (a citizen wallet, a dev view) and keep the neutral blocks unchanged.
 */

/** Shape of the neutral analyze envelope this persona view consumes. */
interface AnalyzeEnvelope {
	summary: { total: number; byState: Record<string, number> };
	groups: Array<{
		key: string;
		label: string;
		count: number;
		records: Array<{ id: string; title: string; link: string }>;
	}>;
}

/** Human labels for the analyst's requirement review states — the persona's language
 * over the neutral state keys. */
const STATE_LABELS: Record<string, string> = {
	reviewed: "Requisitos revisados",
	draft: "Rascunhos a revisar",
	unreviewed: "Sem revisão",
};

/** Render the neutral analyze envelope into a requirements MOC — the product the
 * analyst navigates. Pure string projection; a real deployment would write this to the
 * vault as `MOC - Requisitos.md`. */
function renderRequirementsMoc(env: AnalyzeEnvelope): string {
	const lines: string[] = [
		"# Mapa de Conteúdo — Requisitos",
		"",
		`> ${env.summary.total} requisitos · ` +
			Object.entries(env.summary.byState)
				.map(([state, n]) => `${n} ${STATE_LABELS[state] ?? state}`)
				.join(" · "),
		"",
	];
	for (const group of env.groups) {
		lines.push(`## ${STATE_LABELS[group.key] ?? group.label} (${group.count})`);
		for (const record of group.records) {
			lines.push(`- [[${record.link.replace(/\.md$/, "")}|${record.title}]]`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd() + "\n";
}

/** Build the T3 `requirements moc` verb over the app's records deps. It resolves the
 * neutral `analyze` verb, then projects its envelope into the analyst's MOC. */
export function createRequirementsAreaCapability(
	recordsDeps: RecordsCommandDeps,
): CapabilityDescriptor {
	const recordsGroup = createRecordsCapabilityGroup(recordsDeps);
	const analyzeAction = recordsGroup.actions.analyze;

	return {
		name: "requirements-moc",
		summary:
			"The analyst's requirements area — a navigable Map of Content (product view)",
		options: [
			{ name: "by", kind: "string", summary: "Group by reviewState (default), type, or sourceRef" },
		],
		transports: {
			cli: {},
			repl: {},
			http: { method: "GET", path: "/requirements/moc" },
			agent: { tool: true, toolName: "requirements_moc" },
		},
		renderers: { tui: { section: "notesbox" } },
		async run(input): Promise<CapabilityEnvelope> {
			if (!analyzeAction) throw new Error("records analyze action missing");
			// Consume the NEUTRAL engine — the same envelope every surface reads.
			const analyzed = (await analyzeAction.run({
				args: {},
				options: { by: (input.options.by as string) ?? "reviewState" },
				json: true,
			})) as unknown as AnalyzeEnvelope & { by: string };

			const moc = renderRequirementsMoc(analyzed);
			return buildJsonSuccessEnvelope({
				command: "requirements-moc",
				operation: "render",
				extra: {
					by: analyzed.by,
					total: analyzed.summary.total,
					// The product: a ready-to-read requirements MOC (Obsidian markdown).
					moc,
					groupCount: analyzed.groups.length,
				},
			});
		},
	};
}
