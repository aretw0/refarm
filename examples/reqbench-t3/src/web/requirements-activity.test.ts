/** @vitest-environment jsdom */
import { arrayEventSource, type LiveEventSource } from "@refarm.dev/capability-homestead-surface";
import { describe, expect, it } from "vitest";

import {
	mountRequirementsActivity,
	replayRequirementsActivity,
	requirementActivityRow,
	type RequirementActivityLine,
} from "./requirements-activity.js";

describe("requirements-activity (web twin of the requirements pull)", () => {
	it("maps a pulled requirement to a numbered row", () => {
		expect(
			requirementActivityRow(
				{ id: "RN-632504", tipo: "regra-de-negocio", title: "CNPJ da Escrituração", status: "reviewed" },
				0,
			),
		).toEqual({
			"#": 1,
			id: "RN-632504",
			tipo: "regra-de-negocio",
			status: "reviewed",
			title: "CNPJ da Escrituração",
		});
	});

	it("grows the table one row per requirement (hand-driven source)", () => {
		document.body.innerHTML = `<div id="reqs"></div>`;
		const container = document.getElementById("reqs")!;
		let emit: (r: RequirementActivityLine) => void = () => {};
		const source: LiveEventSource<RequirementActivityLine> = {
			subscribe(onEvent) {
				emit = onEvent;
				return () => {};
			},
		};
		mountRequirementsActivity({ container, source });
		expect(container.querySelectorAll("tbody tr").length).toBe(0);
		emit({ id: "RN-632504", tipo: "regra-de-negocio", title: "CNPJ" });
		emit({ id: "CDU-282405", tipo: "caso-de-uso", title: "Aviso" });
		expect(container.querySelectorAll("tbody tr").length).toBe(2);
		expect(container.textContent).toContain("CDU-282405");
		expect(container.querySelector("caption")?.textContent).toBe("Requirements — live");
	});

	it("replays a corpus to completion (offline demo path)", async () => {
		document.body.innerHTML = `<div id="reqs2"></div>`;
		const container = document.getElementById("reqs2")!;
		const corpus: RequirementActivityLine[] = [
			{ id: "RN-632504", tipo: "regra-de-negocio", title: "CNPJ" },
			{ id: "CDU-282405", tipo: "caso-de-uso", title: "Aviso" },
			{ id: "FUN-284853", tipo: "funcional", title: "Selecionar crédito" },
		];
		await new Promise<void>((resolve) => {
			const drained: LiveEventSource<RequirementActivityLine> = {
				subscribe: (onEvent, onEnd) =>
					arrayEventSource(corpus).subscribe(onEvent, () => {
						onEnd?.();
						resolve();
					}),
			};
			mountRequirementsActivity({ container, source: drained });
		});
		expect(container.querySelectorAll("tbody tr").length).toBe(3);
		expect(container.textContent).toContain("FUN-284853");
	});

	it("replayRequirementsActivity mounts without throwing (smoke)", () => {
		document.body.innerHTML = `<div id="reqs3"></div>`;
		const container = document.getElementById("reqs3")!;
		const stop = replayRequirementsActivity(container, [{ id: "RN-1", tipo: "regra-de-negocio", title: "x" }]);
		expect(container.querySelector("table")).not.toBeNull();
		stop();
	});
});
