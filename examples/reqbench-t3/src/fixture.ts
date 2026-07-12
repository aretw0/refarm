import { computeRecordContentHash, type RecordsManifest } from "@refarm.dev/records-contract-v1";

/**
 * The T3 work layer — the requirements analyst's OWN data. reqbench is a white-label host:
 * the base supplies the neutral blocks, this file supplies the seed the analyst starts from.
 *
 * The SOURCE SYSTEMS are NOT hardcoded here — they come from the analyst's ledger
 * (`.dgk/sources.json`, read by @refarm.dev/source-web's loadWebSourceTargets). Each analyst
 * declares the systems their login can access; `discover` lists exactly those. The example
 * ships a sample EFD target in that ledger so the bench works out of the box.
 *
 * This manifest is the analyst's already-pulled requirements (what a prior `source pull` +
 * ingest produced). A real deployment backs it with the vault; here it seeds a few EFD
 * requirements so the MOC and corrections have something to show.
 */

/** The sample system the analyst chose (mirrors `.dgk/sources.json`); the mechanism reads
 * the ledger, this constant is only the ref the seed records point at. */
export const REQ_SYSTEM_IDENTITY = "efd";
export const REQ_SYSTEM_REF = `web:${REQ_SYSTEM_IDENTITY}`;

interface SeedRequirement {
	id: string;
	externalKey: string;
	tipo: string;
	title: string;
	status: string;
	body: string;
	section: { key: string; content: string };
}

/** A handful of EFD requirements as a starting corpus — typed (regra-de-negócio / caso-de-uso
 * / funcional), some mentioning CNPJ so the rules enrichment has something to tag. */
const SEED_REQUIREMENTS: SeedRequirement[] = [
	{
		id: "record:req-rn632504",
		externalKey: "RN-632504",
		tipo: "regra-de-negocio",
		title: "Identificador do CNPJ da Escrituração",
		status: "reviewed",
		body: "A escrituração é identificada pelo CNPJ do estabelecimento.",
		section: {
			key: "regra",
			content: "Validar e formatar o CNPJ conforme o layout da escrituração.",
		},
	},
	{
		id: "record:req-cdu282405",
		externalKey: "CDU-282405",
		tipo: "caso-de-uso",
		title: "Receber Aviso de Tratamento Manual",
		status: "draft",
		body: "O sistema avisa o analista quando o crédito exige tratamento manual.",
		section: {
			key: "fluxo",
			content: "P1. O sistema identifica o crédito pelo CNPJ e emite o aviso ao analista.",
		},
	},
	{
		id: "record:req-fun284853",
		externalKey: "FUN-284853",
		tipo: "funcional",
		title: "Selecionar o crédito para análise a partir do CNPJ",
		status: "draft",
		body: "Selecionar o crédito para análise informando o CNPJ e o período.",
		section: {
			key: "descricao",
			content: "Permitir selecionar o crédito informando o CNPJ e o período de apuração.",
		},
	},
];

/** The analyst's requirements manifest — the seed corpus, each record carrying an
 * externalKey (for lookup enrichment) and a `body`/section (for rule enrichment to scan). */
export function reqManifest(): RecordsManifest {
	const records = SEED_REQUIREMENTS.map((req) => {
		const record = {
			id: req.id,
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "Requirement"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: {
				title: req.title,
				tipo: req.tipo,
				status: req.status,
				externalKey: req.externalKey,
				body: req.body,
			},
			sections: [req.section],
			sourceRefs: [REQ_SYSTEM_REF],
			review: { state: req.status, at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		};
		return { ...record, contentHash: computeRecordContentHash(record) };
	});
	return { manifestVersion: 1, records } as unknown as RecordsManifest;
}
