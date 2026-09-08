/**
 * Validator for the documento-extraido/v1 envelope.
 *
 * The authority is the JSON Schema at `schema/documento-extraido-v1.json`.
 * This module is deliberately thin — it is a direct port of
 * `scripts/documents/contrato.py` in coop-vault, so the two validators can
 * be proved equivalent against the same conformance fixtures.
 *
 * JSON Schema subset covered, and only it: `type` (including as a list of
 * types), `required`, `properties`, `additionalProperties` as `false` or as
 * a single schema, `enum`, and `items` for arrays. Any construct outside
 * this list is silently ignored — if the schema starts using it, this
 * validator needs to grow along with it (and so does `contrato.py`).
 *
 * A real difference between the languages: in Python, `bool` is a subclass
 * of `int`, so the reference validator explicitly excludes `bool` from the
 * `integer`/`number` type. In TypeScript, `typeof true === "boolean"` is
 * already distinct from `typeof 1 === "number"`, so the exclusion needs no
 * code — but the final behavior, for the same envelope, is the same:
 * `schemaVersion: true` is rejected in both languages.
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
				// Unknown type name: silently ignored, like in Python.
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

/** Returns the list of problems. Empty means valid. */
export function validar(envelope: unknown): string[] {
	return validarNo(envelope, carregarSchemaInterno(), "envelope");
}
