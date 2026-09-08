import { describe, expect, it } from "vitest";
import { carregarFixtures, carregarSchema } from "./index.js";
import { rodarConformidade } from "./conformance.js";
import { validar } from "./validate.js";

describe("contrato documento-extraido/v1", () => {
	it("o schema declara a versão e as classes conhecidas", () => {
		const schema = carregarSchema() as Record<string, unknown>;
		expect(schema.title).toBe("documento-extraido/v1");
		expect(schema.required).toContain("classe");
	});

	it("as fixtures cobrem caso válido e casos inválidos", () => {
		const fixtures = carregarFixtures();
		const validos = fixtures.casos.filter(
			(caso) => caso.caminhos_com_problema.length === 0,
		);
		const invalidos = fixtures.casos.filter(
			(caso) => caso.caminhos_com_problema.length > 0,
		);
		expect(validos.length).toBeGreaterThan(0);
		expect(invalidos.length).toBeGreaterThanOrEqual(8);
	});

	it("o validador TypeScript satisfaz a conformidade", () => {
		const resultado = rodarConformidade(validar);
		expect(resultado.divergencias).toEqual([]);
		expect(resultado.casosRodados).toBe(carregarFixtures().casos.length);
	});

	it("um validador que aceita tudo reprova a conformidade", () => {
		const resultado = rodarConformidade(() => []);
		expect(resultado.divergencias.length).toBeGreaterThan(0);
	});

	it("um validador que recusa tudo reprova a conformidade", () => {
		const resultado = rodarConformidade(() => ["envelope: recusado sempre"]);
		expect(resultado.divergencias.length).toBeGreaterThan(0);
	});
});
