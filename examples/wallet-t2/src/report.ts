import {
	buildJsonSuccessEnvelope,
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
	type RecordsCommandDeps,
} from "@refarm.dev/capability-host";

import { buildSovereigntyReport } from "./sovereignty.js";

/**
 * REPORT — materialize the T2 record material to disk (the citizen-wallet evidence for the
 * writeup). The example already computes the whole sovereign posture (credentials, consent,
 * disclosure, timeline); this consolidates it into the disclosure graph as a standalone `.svg`
 * figure + a `report.md` with the real numbers. Reuses buildSovereigntyReport; nothing new is
 * computed. `--apply` writes it. NOT a panel — a document that feeds the text.
 */

export interface ReportFile {
	path: string;
	content: string;
}

/** Build the T2 record material: the disclosure graph SVG + a markdown report of the posture. */
export function buildWalletReport(recordsDeps: RecordsCommandDeps): ReportFile[] {
	const r = buildSovereigntyReport(recordsDeps);
	const disclosures = r.disclosures.length
		? r.disclosures
				.map((d) => {
					const when = d.status === "revoked" && d.revokedAt ? ` — revogado em ${d.revokedAt}${d.reason ? ` (${d.reason})` : ""}` : "";
					return `- **${d.requester}** · escopo: ${d.scope.join(", ")} · ${d.status}${when}`;
				})
				.join("\n")
		: "- (nada compartilhado ainda)";
	const last = r.lastChange
		? `${r.lastChange.origin ?? "—"} em ${r.lastChange.recordedAt} (${r.lastChange.totalRevisions} revisões)`
		: "sem histórico ainda";

	const md = `# T2 — Cidadão Digital: minha soberania

> Material de registro gerado pelo próprio exemplo (dgk report). Os números vêm da carteira,
> não de afirmação. Figuras: \`diagrams/composition.svg\`, \`diagrams/flow.svg\`, \`.dgk/report/disclosure-graph.svg\`.

## Credenciais

${r.credentials.verified} verificadas · ${r.credentials.draft} a verificar (${r.credentials.total} total).
A verificação é real (assinatura + validade; \`--strict\` adiciona revogação + confiança no emissor),
não um flip de estado. Um emissor fora do trust registry é RECUSADO mesmo com assinatura válida.

## Consentimentos

${r.authorizations.active} ativos · ${r.authorizations.revoked} revogados · ${r.authorizations.expired} expirados.
O cidadão autoriza um escopo para um propósito, apresenta só esse escopo, e revoga — controle soberano.

## Superfície de compartilhamento

${disclosures}

Figura: \`.dgk/report/disclosure-graph.svg\`. Uma aresta revogada carrega quando/por quê
(do RevocationEvent persistido) — a dimensão temporal que o grafo sozinho não tem.

## Histórico

Última mudança: ${last}. A carteira versiona (history:v1): uma autorização authorize→revoke vira
duas revisões (ativa → revogada) da mesma id; import→verify de uma credencial, idem.

## O que os testes garantem

- **verify**: uma credencial expirada/revogada/de-emissor-não-confiável é RECUSADA (não só assinatura).
- **verify-presentation**: o serviço receptor valida holder-binding; uma apresentação vazia é recusada.
- **revogação**: o emissor revoga; a carteira detecta pela status list no re-verify --strict.
- **recover**: a mesma sessão re-deriva a MESMA identidade num device novo, sem expor a chave.

Cada afirmação acima tem um teste que a comprova.
`;

	return [
		{ path: ".dgk/report/disclosure-graph.svg", content: r.graphSvg },
		{ path: ".dgk/report/T2-report.md", content: md },
	];
}

export interface ReportVerbOptions {
	writeReport?: (relativePath: string, content: string) => void | Promise<void>;
}

/**
 * `report [--apply]` — generate the T2 record material: the disclosure graph SVG + a markdown
 * report of the citizen's sovereign posture with the real numbers. `--apply` writes.
 */
export function createWalletReportCapability(
	recordsDeps: RecordsCommandDeps,
	options: ReportVerbOptions = {},
): CapabilityDescriptor {
	return {
		name: "report",
		summary: "Generate the record material — the disclosure graph SVG + a report of the sovereign posture",
		options: [{ name: "apply", kind: "boolean", summary: "Write the report files to disk (else report only)" }],
		transports: { http: { path: "/report" } },
		renderers: { tui: { section: "wallet" }, ide: { command: "dgk.report" } },
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const files = buildWalletReport(recordsDeps);
			const apply = input.options?.apply === true;
			let written = 0;
			if (apply && options.writeReport) {
				for (const f of files) {
					await options.writeReport(f.path, f.content);
					written += 1;
				}
			}
			return buildJsonSuccessEnvelope({
				command: "report",
				operation: "report",
				nextCommand: apply ? "dgk wallet" : "dgk report --apply",
				nextCommands: apply ? [] : ["dgk report --apply"],
				extra: {
					applied: apply,
					written,
					files: files.map((f) => ({ path: f.path, bytes: f.content.length })),
					...(apply ? {} : { markdown: files.find((f) => f.path.endsWith(".md"))?.content }),
				},
			});
		},
	};
}
