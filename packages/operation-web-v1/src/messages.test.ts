import { describe, expect, it } from "vitest";
import {
	createOperationMessages,
	describeOperationRefusal,
	describeOperationRun,
} from "./messages.js";

describe("localized operation messages", () => {
	it("selects the operator language with English fallback", () => {
		expect(createOperationMessages(["pt-BR"]).t("title")).toBe("Operações");
		expect(createOperationMessages(["es-MX"]).t("start")).toBe("Iniciar");
		expect(createOperationMessages(["fr-FR"]).t("title")).toBe("Operations");
	});

	it("keeps node detail while translating the surface verdict", () => {
		const messages = createOperationMessages(["pt-BR"]);
		expect(
			describeOperationRefusal(messages, {
				kind: "unavailable",
				status: 503,
				detail: "spawn indisponível",
			}),
		).toContain("spawn indisponível");
		expect(
			describeOperationRun(messages, { runId: "r", operation: "x", state: "failed", exitCode: 7 }),
		).toBe("Falhou (exit 7)");
	});
});
