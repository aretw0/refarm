/**
 * Validador do envelope documento-extraido/v1.
 *
 * A autoridade é o JSON Schema em `schema/documento-extraido-v1.json`. Este
 * módulo é fino de propósito — é um porte direto de
 * `scripts/documents/contrato.py` no coop-vault, para que os dois validadores
 * possam ser provados equivalentes contra as mesmas fixtures de conformidade.
 *
 * Subconjunto de JSON Schema coberto, e apenas ele: `type` (inclusive lista
 * de tipos), `required`, `properties`, `additionalProperties` como `false`
 * ou como esquema único, `enum`, e `items` para arrays. Qualquer construção
 * fora dessa lista é ignorada em silêncio — se o schema passar a usá-la,
 * este validador precisa crescer junto (e o `contrato.py` também).
 *
 * Uma diferença real entre as linguagens: em Python, `bool` é subclasse de
 * `int`, então o validador de referência exclui `bool` explicitamente do
 * tipo `integer`/`number`. Em TypeScript, `typeof true === "boolean"` já é
 * distinto de `typeof 1 === "number"`, então a exclusão não precisa de
 * código — mas o comportamento final, para o mesmo envelope, é o mesmo:
 * `schemaVersion: true` é recusado nas duas linguagens.
 */

import { readFileSync } from "node:fs";

type JsonSchema = Record<string, unknown>;

let schemaCache: JsonSchema | undefined;

function carregarSchemaInterno(): JsonSchema {
	if (schemaCache === undefined) {
		const caminho = new URL(
			"../schema/documento-extraido-v1.json",
			import.meta.url,
		);
		schemaCache = JSON.parse(
			readFileSync(caminho, "utf-8"),
		) as JsonSchema;
	}
	return schemaCache;
}

function nomeDoTipo(valor: unknown): string {
	if (valor === null) return "null";
	if (Array.isArray(valor)) return "array";
	return typeof valor;
}

function tipoConfere(valor: unknown, esperado: unknown): boolean {
	const nomes = Array.isArray(esperado) ? esperado : [esperado];
	for (const nome of nomes) {
		switch (nome) {
			case "object":
				if (
					typeof valor === "object" &&
					valor !== null &&
					!Array.isArray(valor)
				) {
					return true;
				}
				break;
			case "array":
				if (Array.isArray(valor)) return true;
				break;
			case "string":
				if (typeof valor === "string") return true;
				break;
			case "integer":
				if (typeof valor === "number" && Number.isInteger(valor)) {
					return true;
				}
				break;
			case "number":
				if (typeof valor === "number") return true;
				break;
			case "boolean":
				if (typeof valor === "boolean") return true;
				break;
			case "null":
				if (valor === null) return true;
				break;
			default:
				// Nome de tipo desconhecido: ignorado em silêncio, como no Python.
				break;
		}
	}
	return false;
}

function validarNo(
	valor: unknown,
	esquema: JsonSchema,
	caminho: string,
): string[] {
	const problemas: string[] = [];

	if ("type" in esquema && !tipoConfere(valor, esquema.type)) {
		problemas.push(
			`${caminho}: esperado ${JSON.stringify(esquema.type)}, veio ${nomeDoTipo(valor)}`,
		);
		return problemas;
	}

	if ("enum" in esquema) {
		const opcoes = esquema.enum as unknown[];
		if (!opcoes.some((opcao) => opcao === valor)) {
			problemas.push(`${caminho}: valor fora do enum ${JSON.stringify(opcoes)}`);
		}
	}

	if (
		typeof valor === "object" &&
		valor !== null &&
		!Array.isArray(valor)
	) {
		const objeto = valor as Record<string, unknown>;
		const obrigatorios = (esquema.required as string[] | undefined) ?? [];
		for (const obrigatorio of obrigatorios) {
			if (!(obrigatorio in objeto)) {
				problemas.push(`${caminho}.${obrigatorio}: campo obrigatório ausente`);
			}
		}

		const propriedades =
			(esquema.properties as Record<string, JsonSchema> | undefined) ?? {};
		const extras = "additionalProperties" in esquema
			? esquema.additionalProperties
			: true;
		for (const [chave, sub] of Object.entries(objeto)) {
			const subEsquema = propriedades[chave];
			if (subEsquema !== undefined) {
				problemas.push(
					...validarNo(sub, subEsquema, `${caminho}.${chave}`),
				);
			} else if (extras === false) {
				problemas.push(`${caminho}.${chave}: campo desconhecido`);
			} else if (typeof extras === "object" && extras !== null) {
				problemas.push(
					...validarNo(sub, extras as JsonSchema, `${caminho}.${chave}`),
				);
			}
		}
	}

	if (Array.isArray(valor) && typeof esquema.items === "object" && esquema.items !== null) {
		const itemSchema = esquema.items as JsonSchema;
		valor.forEach((item, indice) => {
			problemas.push(...validarNo(item, itemSchema, `${caminho}[${indice}]`));
		});
	}

	return problemas;
}

/** Devolve a lista de problemas. Vazia significa válido. */
export function validar(envelope: unknown): string[] {
	return validarNo(envelope, carregarSchemaInterno(), "envelope");
}
