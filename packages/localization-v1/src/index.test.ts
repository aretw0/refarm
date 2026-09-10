import { describe, expect, it } from "vitest";
import { catalogParity, createMessageTranslator, formatMessage, resolveLocale } from "./index.js";

describe("surface-neutral localization", () => {
	it("prefers exact locale, then language, with English as the explicit fallback", () => {
		expect(resolveLocale(["pt_BR"])).toBe("pt-BR");
		expect(resolveLocale(["pt-PT"])).toBe("pt-BR");
		expect(resolveLocale(["es-MX"])).toBe("es");
		expect(resolveLocale(["fr-FR"])).toBe("en");
	});

	it("uses selected → English → visible key fallback", () => {
		const translator = createMessageTranslator({
			locale: "pt-BR",
			catalogs: { en: { hello: "Hello", only: "Fallback" }, "pt-BR": { hello: "Olá" } },
		});
		expect(translator.t("hello")).toBe("Olá");
		expect(translator.t("only")).toBe("Fallback");
		expect(translator.t("missing.key")).toBe("missing.key");
	});

	it("interpolates every occurrence without evaluating message content", () => {
		expect(formatMessage("{count} of {count}: {name}", { count: 2, name: "A" })).toBe("2 of 2: A");
	});

	it("reports locale drift against the fallback catalog", () => {
		expect(
			catalogParity({ en: { a: "A", b: "B" }, "pt-BR": { a: "Um" }, es: { a: "A", b: "B" } }),
		).toEqual({
			"pt-BR": ["b"],
		});
	});
});
