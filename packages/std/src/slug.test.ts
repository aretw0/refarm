import { describe, expect, it } from "vitest";

import { slugify } from "./slug.js";

describe("slugify", () => {
	it("strips diacritics (the pt-BR consistency fix)", () => {
		expect(slugify("Título com Acentuação")).toBe("titulo-com-acentuacao");
		expect(slugify("Ação & Reação")).toBe("acao-reacao");
	});
	it("lowercases, collapses non-alphanumerics to a single dash, trims", () => {
		expect(slugify("  Hello,  World!  ")).toBe("hello-world");
		expect(slugify("A---B__C")).toBe("a-b-c");
	});
	it("returns the fallback for an empty result", () => {
		expect(slugify("!!!")).toBe("unnamed");
		expect(slugify("", { fallback: "note" })).toBe("note");
	});
	it("respects maxLength and does not leave a trailing dash", () => {
		expect(slugify("a very long requirement title", { maxLength: 12 })).toBe("a-very-long");
	});
	it("is deterministic", () => {
		expect(slugify("Regra de Negócio")).toBe(slugify("Regra de Negócio"));
	});
});
