/**
 * Language-agnostic conformance suite for the documento-extraido/v1
 * contract.
 *
 * The fixtures in `fixtures/conformance.json` are data, not code: the same
 * list of cases can be consumed by a validator in any language.
 * `rodarConformidade` runs a validator against each case and compares the
 * PATH of each returned problem — not the message, which is free per
 * implementation — against the fixture's `caminhos_com_problema`, as a set.
 */

import { readFileSync } from "node:fs";
import type {
	ConformanceDivergencia,
	ConformanceFixtures,
	ConformanceResult,
} from "./types.js";

let fixturesCache: ConformanceFixtures | undefined;

/** Loads `fixtures/conformance.json` from the package itself. */
export function carregarFixtures(): ConformanceFixtures {
	if (fixturesCache === undefined) {
		const caminho = new URL(
			"../fixtures/conformance.json",
			import.meta.url,
		);
		fixturesCache = JSON.parse(
			readFileSync(caminho, "utf-8"),
		) as ConformanceFixtures;
	}
	return fixturesCache;
}

/**
 * Extracts the path from a problem in the `path: message` format.
 * The message after `:` is free per implementation; only the path matters.
 */
function extrairCaminho(problema: string): string {
	const indice = problema.indexOf(":");
	return indice === -1 ? problema : problema.slice(0, indice);
}

function paraConjuntoOrdenado(caminhos: string[]): string[] {
	return [...new Set(caminhos)].sort();
}

function conjuntosIguais(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((valor, indice) => valor === b[indice]);
}

/**
 * Runs `validador` against each case in the conformance fixtures and
 * returns how many cases ran and which ones diverged from what was
 * expected.
 */
export function rodarConformidade(
	validador: (envelope: unknown) => string[],
): ConformanceResult {
	const fixtures = carregarFixtures();
	const divergencias: ConformanceDivergencia[] = [];

	for (const caso of fixtures.casos) {
		const problemas = validador(caso.envelope);
		const obtido = paraConjuntoOrdenado(problemas.map(extrairCaminho));
		const esperado = paraConjuntoOrdenado(caso.caminhos_com_problema);

		if (!conjuntosIguais(obtido, esperado)) {
			divergencias.push({ nome: caso.nome, esperado, obtido });
		}
	}

	return { casosRodados: fixtures.casos.length, divergencias };
}
