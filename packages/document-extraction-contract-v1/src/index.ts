/**
 * Contrato documento-extraido/v1.
 *
 * A autoridade é o JSON Schema em `schema/documento-extraido-v1.json`,
 * publicado como arquivo de dado no pacote. `validar` é um porte fino do
 * validador Python de referência (`scripts/documents/contrato.py` no
 * coop-vault); `rodarConformidade` prova, contra `fixtures/conformance.json`
 * (também publicado como dado), que os dois validadores concordam.
 */

import { readFileSync } from "node:fs";

export { validar } from "./validate.js";
export { carregarFixtures, rodarConformidade } from "./conformance.js";
export type {
	ClasseDocumento,
	ConformanceCaso,
	ConformanceDivergencia,
	ConformanceFixtures,
	ConformanceResult,
	DocumentoExtraido,
	Fonte,
	Lancamento,
} from "./types.js";

let schemaCache: Record<string, unknown> | undefined;

/** Carrega `schema/documento-extraido-v1.json` do próprio pacote. */
export function carregarSchema(): Record<string, unknown> {
	if (schemaCache === undefined) {
		const caminho = new URL(
			"../schema/documento-extraido-v1.json",
			import.meta.url,
		);
		schemaCache = JSON.parse(
			readFileSync(caminho, "utf-8"),
		) as Record<string, unknown>;
	}
	return schemaCache;
}
