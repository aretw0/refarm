/**
 * Contract documento-extraido/v1.
 *
 * The authority is the JSON Schema at `schema/documento-extraido-v1.json`,
 * published as a data file in the package. `validar` is a thin port of the
 * reference Python validator (`scripts/documents/contrato.py` in
 * coop-vault); `rodarConformidade` proves, against
 * `fixtures/conformance.json` (also published as data), that the two
 * validators agree.
 */

import { readFileSync } from "node:fs";

export { validar } from "./validate.js";
export { carregarFixtures, rodarConformidade } from "./conformance.js";
export {
	createInMemoryDocumentoExtraidoProducer,
	documentoExtraidoReferencia,
} from "./in-memory.js";
export type { DocumentoExtraidoProducer } from "./in-memory.js";
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

/** Loads `schema/documento-extraido-v1.json` from the package itself. */
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
