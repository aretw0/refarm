import { hostCommandOverrideEnv } from "@refarm.dev/capability-host";
import { createCapabilityTestHarness } from "@refarm.dev/capability-host/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
	DGK_COMMAND,
	buildRegistry,
	buildReqbenchHost,
	buildRequirementsBaseModel,
	serveReqbench,
} from "./cli.js";
import { renderRequirementsMocHtml, reqWebSurface } from "./persona.js";
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
		const reg = buildRegistry({ statePath: tempStatePath() });
		const names = reg.list().map((e) => e.name);
		expect(names).toEqual(
			expect.arrayContaining(["source", "records", "vault", "requirements", "status", "actions"]),
		);
	});

	it("declares dgk as the white-label host and exposes action rows", () => {
		const statePath = tempStatePath();
		const host = buildReqbenchHost({ statePath });
		expect(host.program().name()).toBe(DGK_COMMAND);
		const requirementsEntry = host.registry().list().find((entry) => entry.name === "requirements");
		expect(requirementsEntry).toBeTruthy();
		expect(requirementsEntry).toMatchObject({
			renderers: {
				web: { route: "/requirements/moc", icon: "requirements" },
				tui: expect.any(Object),
			},
		});
		expect(buildRequirementsBaseModel({ statePath })).toMatchObject({
			command: DGK_COMMAND,
			operation: "base",
			nextCommand: `${DGK_COMMAND} requirements --json`,
		});
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-requirements",
			"review-draft-requirement",
		]);
	});

	it("supports overriding the host command for white-label use", () => {
		const command = "req-white-label";
		const statePath = tempStatePath();
		const host = buildReqbenchHost({ statePath, command });
		expect(host.program().name()).toBe(command);
		expect(buildRequirementsBaseModel({ statePath, command })).toMatchObject({
			command,
			operation: "base",
			nextCommand: `${command} requirements --json`,
		});
	});

	it("supports overriding host command via explicit environment for white-label use", () => {
		const statePath = tempStatePath();
		const command = "req-white-label-env";
		const host = buildReqbenchHost({
			statePath,
			commandEnv: { [hostCommandOverrideEnv(DGK_COMMAND)]: command },
		});
		expect(host.program().name()).toBe(command);
		expect(buildRequirementsBaseModel({
			statePath,
			commandEnv: { [hostCommandOverrideEnv(DGK_COMMAND)]: command },
		})).toMatchObject({
			command,
			nextCommand: `${command} requirements --json`,
		});
		expect(host.baseModel()).toMatchObject({
			command,
			nextCommand: `${command} requirements --json`,
		});
	});

	it("discovers the analyst's system", async () => {
		const found = await harness.runGroup(
			buildRegistry({ statePath: tempStatePath() }),
			"source",
			["discover"],
		);
		expect(found.ok).toBe(true);
		expect((found.sources as Array<{ ref: string }>).map((s) => s.ref)).toContain(
			REQ_SYSTEM_REF,
		);
	});

	it("the requirements MOC is a navigable product, and reflects a correction", async () => {
		const reg = buildRegistry({ statePath: tempStatePath() });
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
		expect(corrected.nextCommand).toBe(`${DGK_COMMAND} records list`);
		expect(corrected.nextCommands).toEqual([`${DGK_COMMAND} records list`]);

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
		expect(corrected.nextCommand).toBe(`${DGK_COMMAND} records list`);

		const after = await harness.runVerb(buildRegistry({ statePath }), "requirements");
		const moc = after.moc as string;
		expect(moc).toContain("Cadastro de obrigação acessória");
		expect(buildRequirementsBaseModel({ statePath }).nextCommands).toEqual([
			`${DGK_COMMAND} requirements --json`,
		]);
	});

	it("serves the same verbs on the web surface (the analyst's MOC over HTTP)", async () => {
		const { listening, close } = serveReqbench({
			port: 0,
			appOptions: { statePath: tempStatePath() },
		});
		try {
			const { port } = await listening;
			// The persona verb's declared route (/requirements/moc) responds — same product,
			// web surface, from the shared serve seam.
			const res = await fetch(`http://127.0.0.1:${port}/capabilities/requirements/moc`);
			expect(res.status).toBe(200);
			const body = (await res.json()) as { ok: boolean; moc: string };
			expect(body.ok).toBe(true);
			expect(body.moc).toContain("Mapa de Conteúdo — Requisitos");

			const specRes = await fetch(`http://127.0.0.1:${port}/docs/openapi.json`);
			expect(specRes.status).toBe(200);
			const spec = await specRes.json() as {
				info: { title: string; version: string };
				paths: Record<string, unknown>;
			};
			expect(spec.info).toEqual({
				title: `${DGK_COMMAND} Requirements Bench API`,
				version: "0.0.0",
			});
			expect(Object.keys(spec.paths)).toContain("/capabilities/requirements/moc");
		} finally {
			await close();
		}
	});

	it("renders the MOC as NAVIGABLE web HTML (structured, not raw markdown)", () => {
		// T3 richness: the MOC is markdown-with-wikilinks; the web needs native nav, not
		// literal `- [[link|title]]`. renderRequirementsMocHtml projects the same structured
		// groups/records into <nav>/<ul><li><a> with DS classes.
		const env = {
			by: "reviewState",
			summary: { total: 2, byState: { draft: 2 } },
			groups: [
				{
					key: "draft",
					label: "draft",
					count: 2,
					records: [
						{ title: "Cadastro de obrigação acessória", link: "req-cadastro.md" },
						{ title: "Validação de CNPJ", link: "req-validacao.md" },
					],
				},
			],
		} as never;
		const html = renderRequirementsMocHtml(env);
		expect(html).toContain("data-requirements-moc");
		expect(html).toContain("Cadastro de obrigação acessória");
		expect(html).toContain('<a href="req-cadastro.md"');
		// Structured, not markdown: no literal wikilink syntax.
		expect(html).not.toContain("[[");
	});

	it("the bench web surface injects the MOC content above the launcher cards (content seam)", async () => {
		// T3 as a web PRODUCT: the bridge renders the requirements launcher card AND the
		// navigable MOC (supplied via host.data.mocHtml by the content seam) above it.
		const handle = reqWebSurface(buildRegistry());
		const request = {
			host: { hostId: "test", data: { mocHtml: '<nav data-requirements-moc>REQ MAP</nav>' } },
		};
		const result = (await handle.call?.("renderHomesteadSurface", request)) as { html: string };
		expect(result.html).toContain("Bancada de Requisitos");
		expect(result.html).toContain("data-requirements-moc");
		expect(result.html).toContain("REQ MAP");
		// The requirements launcher card is present too.
		expect(result.html).toContain("requirements");
	});
});
