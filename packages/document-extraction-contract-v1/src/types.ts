/**
 * Tipos do envelope documento-extraido/v1, derivados do JSON Schema em
 * `schema/documento-extraido-v1.json`. O schema é a autoridade; estes tipos
 * são uma projeção para conveniência de quem consome o pacote em TypeScript,
 * não uma segunda fonte de verdade.
 */

/** As cinco classes de documento conhecidas pelo contrato. */
export type ClasseDocumento =
	| "nfce"
	| "extrato-pluxee"
	| "extrato-sicoob"
	| "fatura-cartao"
	| "contracheque";

/** Metadados de proveniência do arquivo de onde o envelope foi extraído. */
export interface Fonte {
	sha256: string;
	bytes: number;
	paginas: number;
	extraido_em: string;
}

/** Um lançamento financeiro dentro do envelope. Dinheiro é sempre string decimal. */
export interface Lancamento {
	data: string;
	descricao: string;
	/** Valor decimal como string — dinheiro nunca atravessa o envelope como number. */
	valor: string;
	natureza: "entrada" | "saida";
	contraparte?: string | null;
	documento?: string | null;
	parcela?: string | null;
	moeda_estrangeira?: string | null;
}

/** O envelope comum emitido por todo extrator de documento doméstico. */
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

/** Um caso de conformidade: um envelope e os caminhos de problema esperados. */
export interface ConformanceCaso {
	nome: string;
	envelope: unknown;
	caminhos_com_problema: string[];
}

/** A suíte de fixtures de conformidade, carregada de `fixtures/conformance.json`. */
export interface ConformanceFixtures {
	descricao: string;
	casos: ConformanceCaso[];
}

/** Uma divergência entre o que um validador produziu e o que a fixture esperava. */
export interface ConformanceDivergencia {
	nome: string;
	esperado: string[];
	obtido: string[];
}

/** O resultado de rodar um validador contra toda a suíte de conformidade. */
export interface ConformanceResult {
	casosRodados: number;
	divergencias: ConformanceDivergencia[];
}
