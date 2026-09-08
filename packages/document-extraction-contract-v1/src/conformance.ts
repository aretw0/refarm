/**
 * Suíte de conformidade agnóstica de linguagem para o contrato
 * documento-extraido/v1.
 *
 * As fixtures em `fixtures/conformance.json` são dado, não código: a mesma
 * lista de casos pode ser consumida por um validador em qualquer linguagem.
 * `rodarConformidade` roda um validador contra cada caso e compara o
 * CAMINHO de cada problema devolvido — não a mensagem, que é livre por
 * implementação — com `caminhos_com_problema` da fixture, como conjunto.
 */

import { readFileSync } from "node:fs";
import type {
	ConformanceDivergencia,
	ConformanceFixtures,
	ConformanceResult,
} from "./types.js";

let fixturesCache: ConformanceFixtures | undefined;

/** Carrega `fixtures/conformance.json` do próprio pacote. */
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
 * Extrai o caminho de um problema no formato `caminho: mensagem`.
 * A mensagem depois de `:` é livre por implementação; só o caminho importa.
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
 * Roda `validador` contra cada caso das fixtures de conformidade e devolve
 * quantos casos rodaram e quais divergiram do esperado.
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
