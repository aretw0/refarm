import {
	computeRecordContentHash,
	type RecordsManifest,
} from "@refarm.dev/records-contract-v1";

/**
 * The T2 work layer — the CITIZEN's own data. wallet is a white-label host: the base
 * neutral blocks underneath, this file holds what the citizen keeps in their sovereign
 * wallet (documents/credentials they own). Local-first: the citizen's data is theirs.
 */

/** The citizen's wallet manifest — the items they hold. Each record is a wallet item
 * (a document/credential) with a review state the citizen curates. */
export function walletManifest(): RecordsManifest {
	const records = [
		{
			id: "record:doc-identidade",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "WalletItem"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: { title: "Documento de identidade", kind: "documento", externalKey: "W-1" },
			sections: [{ key: "description", content: "Identidade civil do cidadão." }],
			review: { state: "verified", at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		},
		{
			id: "record:cred-assinatura",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "WalletItem"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: { title: "Certificado de assinatura", kind: "credencial", externalKey: "W-2" },
			sections: [{ key: "description", content: "Chave para assinar documentos." }],
			review: { state: "draft", at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		},
		{
			id: "record:doc-comprovante",
			schemaVersion: 1,
			"@type": ["KnowledgeRecord", "WalletItem"],
			"@context": "https://refarm.dev/contexts/records/v1",
			fields: { title: "Comprovante de residência", kind: "documento", externalKey: "W-3" },
			sections: [{ key: "description", content: "Comprovante recente." }],
			review: { state: "verified", at: "2026-07-07T00:00:00.000Z" },
			contentHash: "",
		},
	].map((record) => ({ ...record, contentHash: computeRecordContentHash(record) }));
	return { manifestVersion: 1, records } as unknown as RecordsManifest;
}
