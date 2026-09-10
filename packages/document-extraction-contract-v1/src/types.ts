/**
 * Types for the documento-extraido/v1 envelope, derived from the JSON
 * Schema at `schema/documento-extraido-v1.json`. The schema is the
 * authority; these types are a projection for the convenience of whoever
 * consumes the package in TypeScript, not a second source of truth.
 */

/** The five document classes known to the contract. */
export type ClasseDocumento =
	| "nfce"
	| "extrato-pluxee"
	| "extrato-sicoob"
	| "fatura-cartao"
	| "contracheque";

/** Provenance metadata for the file the envelope was extracted from. */
export interface Fonte {
	sha256: string;
	bytes: number;
	paginas: number;
	extraido_em: string;
}

/** A financial entry inside the envelope. Money is always a decimal string. */
export interface Lancamento {
	data: string;
	descricao: string;
	/** Decimal value as a string — money never crosses the envelope as a number. */
	valor: string;
	natureza: "entrada" | "saida";
	contraparte?: string | null;
	documento?: string | null;
	parcela?: string | null;
	moeda_estrangeira?: string | null;
}

/** The common envelope emitted by every domestic document extractor. */
export interface DocumentoExtraido {
	schemaVersion: 1;
	classe: ClasseDocumento;
	fonte: Fonte;
	emissor?: {
		nome?: string | null;
		cnpj?: string | null;
	};
	competencia?: string | null;
	totais?: Record<string, unknown>;
	lancamentos: Lancamento[];
	sinais_privacidade?: Record<string, number>;
	avisos: string[];
}

/** A conformance case: an envelope and its expected problem paths. */
export interface ConformanceCaso {
	nome: string;
	envelope: unknown;
	caminhos_com_problema: string[];
}

/** The conformance fixture suite, loaded from `fixtures/conformance.json`. */
export interface ConformanceFixtures {
	descricao: string;
	casos: ConformanceCaso[];
}

/** A divergence between what a validator produced and what the fixture expected. */
export interface ConformanceDivergencia {
	nome: string;
	esperado: string[];
	obtido: string[];
}

/** The result of running a validator against the whole conformance suite. */
export interface ConformanceResult {
	casosRodados: number;
	divergencias: ConformanceDivergencia[];
}
