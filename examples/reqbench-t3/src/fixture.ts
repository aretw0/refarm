import { computeRecordContentHash, type RecordsManifest } from "@refarm.dev/records-contract-v1";
import { DEFAULT_WEB_SOURCE_FIXTURE, type WebSourceSnapshot } from "@refarm.dev/source-web";

/**
 * The T3 work layer — the requirements analyst's OWN data. reqbench is a white-label
 * host: the base supplies the neutral blocks, this file supplies the domain (systems
 * the analyst can access + the requirements they hold). None of this lives upstream.
 */

export const REQ_SYSTEM_IDENTITY = "reqbench-alm";
export const REQ_SYSTEM_REF = `web:${REQ_SYSTEM_IDENTITY}`;

/** A source system the analyst discovers + pulls requirements from. */
export const REQ_SYSTEM_FIXTURE: WebSourceSnapshot = {
	...DEFAULT_WEB_SOURCE_FIXTURE,
	identity: REQ_SYSTEM_IDENTITY,
	url: "https://reqbench.example/alm/requirements",
	body: [
		"<!doctype html>",
		"<html><body>",
		"<article data-req='REQ-1'>Cadastro de obrigação acessória</article>",
		"<article data-req='REQ-2'>Validação de layout do arquivo</article>",
		"</body></html>",
	].join(""),
};

export const REQ_SOURCE_FIXTURES: Record<string, WebSourceSnapshot> = {
	[REQ_SYSTEM_IDENTITY]: REQ_SYSTEM_FIXTURE,
};

/** The analyst's requirements manifest. Each record carries an externalKey the
 * enrichment lookup matches on. */
export function reqManifest(): RecordsManifest {
	const records = [
		{
			id: "record:req-cadastro",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "Requirement"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: {
				title: "Cadastro de obrigação acessória",
				status: "draft",
				externalKey: "REQ-1",
			},
			sections: [{ key: "description", content: "O sistema deve permitir cadastrar a obrigação." }],
			sourceRefs: [REQ_SYSTEM_REF],
			review: { state: "draft", at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		},
		{
			id: "record:req-layout",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "Requirement"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: {
				title: "Validação de layout do arquivo",
				status: "reviewed",
				externalKey: "REQ-2",
			},
			sections: [{ key: "acceptance", content: "- Rejeitar layout fora do esquema." }],
			sourceRefs: [REQ_SYSTEM_REF],
			review: { state: "reviewed", at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		},
	].map((record) => ({ ...record, contentHash: computeRecordContentHash(record) }));
	return { manifestVersion: 1, records } as unknown as RecordsManifest;
}
