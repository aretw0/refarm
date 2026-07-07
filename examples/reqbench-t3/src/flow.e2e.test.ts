import {
	isCapabilityGroup,
	resolveGroupAction,
	type CapabilityEntry,
	type CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { serveCapabilities } from "@refarm.dev/capabilities-v1";

import { buildRegistry } from "./cli.js";
import { REQ_SYSTEM_REF } from "./fixture.js";

/**
 * The T3 flow, end-to-end through reqbench's own CLI registry: discover a system →
 * pull → correct → read the requirements MOC (the analyst's product). refarm underneath,
 * one persona verb on top.
 */
function group(reg: ReturnType<typeof buildRegistry>, name: string): CapabilityGroup {
	const entry = reg.list().find((e: CapabilityEntry) => e.name === name);
	if (!entry || !isCapabilityGroup(entry)) throw new Error(`no group ${name}`);
	return entry;
}

async function runGroup(
	reg: ReturnType<typeof buildRegistry>,
	name: string,
	tokens: string[],
): Promise<Record<string, unknown>> {
	const resolved = resolveGroupAction(group(reg, name), tokens);
	if (!resolved) throw new Error(`cannot resolve ${name} ${tokens.join(" ")}`);
	return (await resolved.action.run(resolved.input)) as unknown as Record<string, unknown>;
}

async function runVerb(
	reg: ReturnType<typeof buildRegistry>,
	name: string,
): Promise<Record<string, unknown>> {
	const entry = reg.list().find((e) => e.name === name);
	if (!entry || isCapabilityGroup(entry)) throw new Error(`no verb ${name}`);
	return (await entry.run({ args: {}, options: {}, json: true })) as unknown as Record<
		string,
		unknown
	>;
}

describe("reqbench T3 — the analyst's requirements bench (result mode)", () => {
	it("mounts the neutral chain + the one persona verb", () => {
		const reg = buildRegistry();
		const names = reg.list().map((e) => e.name);
		expect(names).toEqual(
			expect.arrayContaining(["source", "records", "vault", "requirements-moc"]),
		);
	});

	it("discovers the analyst's system", async () => {
		const found = await runGroup(buildRegistry(), "source", ["discover"]);
		expect(found.ok).toBe(true);
		expect((found.sources as Array<{ ref: string }>).map((s) => s.ref)).toContain(
			REQ_SYSTEM_REF,
		);
	});

	it("the requirements MOC is a navigable product, and reflects a correction", async () => {
		const reg = buildRegistry();
		// Before: one draft + one reviewed.
		const before = await runVerb(reg, "requirements-moc");
		expect((before.moc as string).startsWith("# Mapa de Conteúdo — Requisitos")).toBe(true);

		// The analyst reviews the draft requirement (persists via shared records deps).
		const corrected = await runGroup(reg, "records", [
			"correct",
			"record:req-cadastro",
			"reviewed",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);

		// After: the MOC's reviewed section now lists both requirements.
		const after = await runVerb(reg, "requirements-moc");
		const reviewed = (after.moc as string).slice(
			(after.moc as string).indexOf("Requisitos revisados"),
		);
		expect(reviewed).toContain("Cadastro de obrigação acessória");
		expect(reviewed).toContain("Validação de layout do arquivo");
	});

	it("serves the same verbs on the web surface (the analyst's MOC over HTTP)", async () => {
		const { listening, close } = serveCapabilities(buildRegistry(), { port: 0 });
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
