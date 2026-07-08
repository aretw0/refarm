import { createCapabilityTestHarness } from "@refarm.dev/capabilities-v1/testing";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry, buildReqbenchHost, buildRequirementsBaseModel } from "./cli.js";
import { REQ_SYSTEM_REF } from "./fixture.js";

const harness = createCapabilityTestHarness({ tempPrefix: "dgk-requirements-state-" });

afterEach(() => {
	harness.cleanup();
});

function tempStatePath(): string {
	return harness.tempStatePath();
}

/**
 * The T3 flow, end-to-end through dgk's own CLI registry: discover a system →
 * pull → correct → read the requirements MOC (the analyst's product). Base underneath,
 * one persona verb on top.
 */
describe("reqbench T3 — the analyst's requirements bench (result mode)", () => {
	it("mounts the neutral chain + the one persona verb", () => {
		const reg = buildRegistry();
		const names = reg.list().map((e) => e.name);
		expect(names).toEqual(
			expect.arrayContaining(["source", "records", "vault", "requirements", "status", "actions"]),
		);
	});

	it("declares dgk as the white-label host and exposes action rows", () => {
		const host = buildReqbenchHost();
		expect(host.program().name()).toBe("dgk");
		expect(buildRequirementsBaseModel()).toMatchObject({
			command: "dgk",
			operation: "base",
			nextCommand: "dgk requirements --json",
		});
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-requirements",
			"review-draft-requirement",
		]);
	});

	it("discovers the analyst's system", async () => {
		const found = await harness.runGroup(buildRegistry(), "source", ["discover"]);
		expect(found.ok).toBe(true);
		expect((found.sources as Array<{ ref: string }>).map((s) => s.ref)).toContain(
			REQ_SYSTEM_REF,
		);
	});

	it("the requirements MOC is a navigable product, and reflects a correction", async () => {
		const reg = buildRegistry();
		// Before: one draft + one reviewed.
		const before = await harness.runVerb(reg, "requirements");
		expect((before.moc as string).startsWith("# Mapa de Conteúdo — Requisitos")).toBe(true);

		// The analyst reviews the draft requirement (persists via shared records deps).
		const corrected = await harness.runGroup(reg, "records", [
			"correct",
			"record:req-cadastro",
			"reviewed",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe("dgk records list");
		expect(corrected.nextCommands).toEqual(["dgk records list"]);

		// After: the MOC's reviewed section now lists both requirements.
		const after = await harness.runVerb(reg, "requirements");
		const reviewed = (after.moc as string).slice(
			(after.moc as string).indexOf("Requisitos revisados"),
		);
		expect(reviewed).toContain("Cadastro de obrigação acessória");
		expect(reviewed).toContain("Validação de layout do arquivo");
	});

	it("persists analyst corrections across separate CLI registries when state is configured", async () => {
		const statePath = tempStatePath();
		const corrected = await harness.runGroup(buildRegistry({ statePath }), "records", [
			"correct",
			"record:req-cadastro",
			"reviewed",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe("dgk records list");

		const after = await harness.runVerb(buildRegistry({ statePath }), "requirements");
		const moc = after.moc as string;
		expect(moc).toContain("Cadastro de obrigação acessória");
		expect(buildRequirementsBaseModel({ statePath }).nextCommands).toEqual([
			"dgk requirements --json",
		]);
	});

	it("serves the same verbs on the web surface (the analyst's MOC over HTTP)", async () => {
		const { listening, close } = buildReqbenchHost().serve({ port: 0 });
		try {
			const { port } = await listening;
			// The persona verb's declared route (/requirements/moc) responds — same product,
			// web surface, from the shared serve seam.
			const res = await fetch(`http://127.0.0.1:${port}/capabilities/requirements/moc`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { ok: boolean; moc: string };
			expect(body.ok).toBe(true);
			expect(body.moc).toContain("Mapa de Conteúdo — Requisitos");
		} finally {
			await close();
		}
	});
});
