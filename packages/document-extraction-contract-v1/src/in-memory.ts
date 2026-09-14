import type { DocumentoExtraido } from "./types.js";

/** A minimal producer surface a document extractor can implement. */
export interface DocumentoExtraidoProducer {
	extrair(): DocumentoExtraido;
}

/**
 * Canonical valid documento-extraido/v1 envelope.
 *
 * It is a small reference producer, not a second schema: consumers can run it
 * through `validar` and `rodarConformidade` to see the contract satisfied end
 * to end before connecting a real PDF/OCR source.
 */
export function documentoExtraidoReferencia(): DocumentoExtraido {
	return {
		schemaVersion: 1,
		classe: "contracheque",
		fonte: {
			sha256: "0000000000000000000000000000000000000000000000000000000000000000",
			bytes: 1234,
			paginas: 2,
			extraido_em: "2026-09-06T10:00:00-03:00",
		},
		lancamentos: [],
		avisos: [],
	};
}

/** Returns a stable in-memory producer for examples and conformance harnesses. */
export function createInMemoryDocumentoExtraidoProducer(
	documento: DocumentoExtraido = documentoExtraidoReferencia(),
): DocumentoExtraidoProducer {
	return { extrair: () => documento };
}
