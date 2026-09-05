import en from "@refarm.dev/locales/en.json";
import es from "@refarm.dev/locales/es.json";
import ptBR from "@refarm.dev/locales/pt-BR.json";
import { catalogParity } from "@refarm.dev/localization-v1";
import { describe, expect, it } from "vitest";
import { createHomesteadL8n } from "./l8n-host.js";

describe("Homestead localization", () => {
	it("keeps every shipped catalog aligned with the English fallback", () => {
		expect(catalogParity({ en, "pt-BR": ptBR, es })).toEqual({});
	});

	it("resolves regional browser locales to a supported catalog", () => {
		expect(createHomesteadL8n("pt-PT").currentLocale).toBe("pt-BR");
		expect(createHomesteadL8n("es-MX").currentLocale).toBe("es");
		expect(createHomesteadL8n("fr-FR").currentLocale).toBe("en");
	});
});
