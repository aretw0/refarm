import { hostCommandOverrideEnv } from "@refarm.dev/capability-host";
import { createCapabilityTestHarness } from "@refarm.dev/capability-host/testing";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	DGK_COMMAND,
	buildRegistry,
	buildReqbenchHost,
	buildRequirementsBaseModel,
	serveReqbench,
} from "./cli.js";
import {
	createRequirementsSourceProvider,
	parseRequirements,
	parseRequirementsFromHtml,
	renderRequirementsMocHtml,
	reqWebSurface,
} from "./persona.js";
import { REQ_SYSTEM_REF } from "./fixture.js";
import { ingestSourceToRecords } from "@refarm.dev/capability-host/node";

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
		const requirementsEntry = host
			.registry()
			.list()
			.find((entry) => entry.name === "requirements");
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
		expect(
			buildRequirementsBaseModel({
				statePath,
				commandEnv: { [hostCommandOverrideEnv(DGK_COMMAND)]: command },
			}),
		).toMatchObject({
			command,
			nextCommand: `${command} requirements --json`,
		});
		expect(host.baseModel()).toMatchObject({
			command,
			nextCommand: `${command} requirements --json`,
		});
	});

	it("discovers the analyst's system (from the sample .dgk ledger, EFD)", async () => {
		const found = await harness.runGroup(buildRegistry({ statePath: tempStatePath() }), "source", [
			"discover",
		]);
		expect(found.ok).toBe(true);
		expect((found.sources as Array<{ ref: string }>).map((s) => s.ref)).toContain(REQ_SYSTEM_REF);
	});

	it("`requirements-pull <system>` is a real command: pull → the requirements persist", async () => {
		// The journey as COMMANDS: an empty bench, pull EFD, and the requirements are there.
		const statePath = tempStatePath();
		const reg = buildRegistry({ statePath });
		const pull = reg.get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("requirements-pull verb not mounted");

		const res = (await pull.run({
			args: { ref: REQ_SYSTEM_REF },
			options: {},
			json: true,
		})) as unknown as {
			ingested: number;
			persisted: boolean;
			loggedIn: boolean;
			principal?: string;
		};
		expect(res.persisted).toBe(true);
		expect(res.ingested).toBe(3);
		// LOGIN-GARANTIDO: the sample ships a valid declared session (no expiry), so the pull
		// REUSES it — no fresh login — and reports the authenticated principal.
		expect(res.loggedIn).toBe(false);
		expect(res.principal).toBe("analyst");

		// A fresh registry over the SAME state sees the pulled requirements (persistence).
		const after = await harness.runVerb(buildRegistry({ statePath }), "requirements");
		expect(after.moc as string).toContain("Identificador do CNPJ da Escrituração");
	});

	it("LOGIN-GARANTIDO: pull runs the login when the ledger has no valid session", async () => {
		// The analyst points at a system with no cached session → the injected driver signs
		// in before scraping. Here we prove the gate FIRES: a temp ledger with a session-less
		// target makes the pull run `login` (the fixture), report loggedIn:true, and still
		// ingest. A real deployment injects a browser driver in place of the fixture.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqbench-nosession-"));
		const configPath = path.join(dir, "sources.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				targets: [
					{
						identity: "efd",
						url: "https://alm.example/efd",
						// A single typed requirement, and NO session declared → login must run.
						body: '<article data-req="RN-1" data-type="regra-de-negocio" data-title="Regra"></article>',
						mediaType: "text/html",
					},
				],
			}),
		);
		const statePath = tempStatePath();
		const reg = buildRegistry({ statePath, sourcesConfigPath: configPath });
		const pull = reg.get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("verb not mounted");

		const res = (await pull.run({
			args: { ref: REQ_SYSTEM_REF },
			options: {},
			json: true,
		})) as unknown as { ok: boolean; ingested: number; loggedIn: boolean; principal?: string };
		expect(res.ok).toBe(true);
		expect(res.loggedIn).toBe(true); // no valid session → the driver signed in
		expect(res.ingested).toBe(1);
	});

	it("`requirements-pull` errors helpfully with no ref", async () => {
		const reg = buildRegistry({ statePath: tempStatePath() });
		const pull = reg.get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("verb not mounted");
		const res = (await pull.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			nextAction?: string;
		};
		expect(res.ok).toBe(false);
		expect(res.nextAction).toBe("dgk source discover");
	});

	it("PULL → INGEST: pulling the chosen system turns its requirements into records", async () => {
		// The spine of the analyst's journey: pick a system (EFD, from the ledger), pull it,
		// and its requirements become records — via the generic ingest + the analyst's parser.
		const sourceProvider = createRequirementsSourceProvider();
		const ingested = await ingestSourceToRecords({
			sourceProvider,
			ref: REQ_SYSTEM_REF, // web:efd (the sample the analyst chose)
			parse: parseRequirementsFromHtml,
		});
		// The EFD sample body has 3 typed requirements → 3 records, typed + sourced.
		expect(ingested.records).toHaveLength(3);
		const byTipo = ingested.records.map((r) => r.fields.tipo).sort();
		expect(byTipo).toEqual(["caso-de-uso", "funcional", "regra-de-negocio"]);
		const rn = ingested.records.find((r) => r.fields.tipo === "regra-de-negocio");
		expect(rn?.fields.title).toBe("Identificador do CNPJ da Escrituração");
		expect(rn?.sourceRefs).toEqual([REQ_SYSTEM_REF]);
		expect(rn?.contentHash).toMatch(/^fnv1a32:/);
	});

	it("is CONFIG-DRIVEN: discover lists whatever systems the analyst declares in their ledger", async () => {
		// The systems are NOT hardcoded — they come from the analyst's ledger. Point the
		// bundle at a temp ledger declaring a different system and discover reflects it.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqbench-ledger-"));
		const configPath = path.join(dir, "sources.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				targets: [
					{ identity: "my-alm", url: "https://alm.mine/rm", body: "<p>my requirements</p>" },
				],
			}),
		);
		try {
			const found = await harness.runGroup(
				buildRegistry({ statePath: tempStatePath(), sourcesConfigPath: configPath }),
				"source",
				["discover"],
			);
			const refs = (found.sources as Array<{ ref: string }>).map((s) => s.ref);
			expect(refs).toContain("web:my-alm");
			// The sample EFD is NOT present — the ledger, not the code, decides.
			expect(refs).not.toContain("web:efd");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("LIVE OSLC pull: fetches the system over the RDF contract and parses it into records", async () => {
		// The operationally-faithful path: the analyst's target declares an http URL + the OSLC
		// coordinate (streamURI/componentURI); the injected OSLC driver GETs it with the RDF
		// headers and Configuration-Context, and the RDF is parsed into typed records. A real
		// deployment swaps the mock fetch for one bound to an authenticated browser session.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqbench-oslc-"));
		const configPath = path.join(dir, "sources.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				targets: [
					{
						identity: "efd",
						url: "https://alm.example/rm/resources/TX_10",
						session: { kind: "authenticated", principal: "analyst" },
						attributes: { streamURI: "urn:stream:efd", componentURI: "urn:comp:efd" },
					},
				],
			}),
		);
		const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:jazz_rm="http://jazz.net/ns/rm#">
			<rdf:Description rdf:about="https://alm.example/rm/resources/TX_10">
				<dcterms:identifier>RN-632504</dcterms:identifier>
				<dcterms:title>Identificador do CNPJ da Escrituração</dcterms:title>
				<rdf:type rdf:resource="http://jazz.net/ns/rm#BusinessRule"/>
				<jazz_rm:primaryText><p>O <b>CNPJ</b> identifica.</p></jazz_rm:primaryText>
			</rdf:Description>
		</rdf:RDF>`;
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Response(rdf, { status: 200, headers: { "content-type": "application/rdf+xml" } }),
		);
		try {
			const provider = createRequirementsSourceProvider({
				cacheRoot: dir,
				sourcesConfigPath: configPath,
				fetchImpl,
			});
			const ingested = await ingestSourceToRecords({
				sourceProvider: provider,
				ref: REQ_SYSTEM_REF, // web:efd
				parse: parseRequirements,
				offline: false, // allow the live fetch
			});
			// The OSLC driver was called with the target's URL + the OSLC contract headers.
			expect(fetchImpl).toHaveBeenCalledOnce();
			expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://alm.example/rm/resources/TX_10");
			const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
			expect(headers.Accept).toBe("application/rdf+xml");
			expect(headers["Configuration-Context"]).toBe("urn:stream:efd");
			// The RDF was parsed (not the fixture) into the typed record.
			expect(ingested.records).toHaveLength(1);
			const fields = ingested.records[0]?.fields as Record<string, unknown>;
			expect(fields.tipo).toBe("regra-de-negocio");
			expect(fields.title).toBe("Identificador do CNPJ da Escrituração");
			expect(fields.artifactUri).toBe("https://alm.example/rm/resources/TX_10");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("LIVE OSLC pull RECOVERS from a mid-pull 401 by re-authenticating and retrying", async () => {
		// The session expires mid-pull (Jazz answers 401). The generic reauth loop re-runs the
		// login and retries — so the pull still succeeds. This is the vault's recovery behavior,
		// proven end-to-end with a mock that 401s once then serves the RDF.
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqbench-401-"));
		const configPath = path.join(dir, "sources.json");
		fs.writeFileSync(
			configPath,
			JSON.stringify({
				targets: [
					{
						identity: "efd",
						url: "https://alm.example/rm/resources/TX_10",
						session: { kind: "authenticated", principal: "analyst" },
						attributes: { streamURI: "urn:stream:efd" },
					},
				],
			}),
		);
		const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:jazz_rm="http://jazz.net/ns/rm#">
			<rdf:Description rdf:about="https://alm.example/rm/resources/TX_10">
				<dcterms:identifier>RN-1</dcterms:identifier>
				<dcterms:title>Regra</dcterms:title>
				<rdf:type rdf:resource="http://jazz.net/ns/rm#BusinessRule"/>
			</rdf:Description>
		</rdf:RDF>`;
		let call = 0;
		const fetchImpl = vi.fn<typeof fetch>(async () => {
			call += 1;
			return call === 1
				? new Response("session expired", { status: 401 })
				: new Response(rdf, { status: 200, headers: { "content-type": "application/rdf+xml" } });
		});
		const reLogin = vi.fn(async () => ({
			kind: "authenticated" as const,
			authenticated: true,
			principal: "re-authed",
		}));
		try {
			const provider = createRequirementsSourceProvider({
				cacheRoot: dir,
				sourcesConfigPath: configPath,
				fetchImpl: fetchImpl as unknown as typeof fetch,
				login: reLogin,
			});
			const ingested = await ingestSourceToRecords({
				sourceProvider: provider,
				ref: REQ_SYSTEM_REF,
				parse: parseRequirements,
				offline: false,
			});
			expect(fetchImpl).toHaveBeenCalledTimes(2); // 401, then success
			expect(reLogin).toHaveBeenCalledOnce(); // re-authenticated between attempts
			expect(ingested.records).toHaveLength(1); // the pull still delivered the requirement
			expect(ingested.records[0]?.fields.externalKey).toBe("RN-1");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("enriches requirements with the analyst's rules (text mentioning CNPJ gets tagged)", async () => {
		// The generic rules engine + the analyst's fiscal rules: requirements whose body/title
		// mention CNPJ gain the req/cnpj tag, idempotently.
		const reg = buildRegistry({ statePath: tempStatePath() });
		const enriched = await harness.runGroup(reg, "records", ["enrich", "--apply"]);
		expect(enriched.ok).not.toBe(false);
		// The seed has requirements mentioning CNPJ, so at least one record was enriched.
		const diagnostics = enriched.diagnostics as { enriched?: number } | undefined;
		expect(diagnostics?.enriched ?? 0).toBeGreaterThan(0);
	});

	it("the MOC groups requirements by TYPE (regra-de-negócio / caso-de-uso / funcional)", async () => {
		// A real requirements MOC is organized by artifact type, not just review state.
		// The bench groups by field:tipo — the generic domain-dimension lens.
		const env = await harness.runVerb(
			buildRegistry({ statePath: tempStatePath() }),
			"requirements",
		);
		const moc = env.moc as string;
		expect(moc).toContain("## Regras de Negócio");
		expect(moc).toContain("## Casos de Uso");
		expect(moc).toContain("## Requisitos Funcionais");
		// Each type section lists its requirement by title.
		expect(moc).toContain("Identificador do CNPJ da Escrituração"); // RN
		expect(moc).toContain("Receber Aviso de Tratamento Manual"); // CDU
	});

	it("the MOC renders the requirement GRAPH — a use case links to the rule it references", async () => {
		// The CDU/FUN reference the CNPJ business rule; the MOC shows those tipped links as
		// navigable wikilinks under each requirement (the vault's alm_link_relations shape).
		const env = await harness.runVerb(
			buildRegistry({ statePath: tempStatePath() }),
			"requirements",
		);
		const moc = env.moc as string;
		// Under the use case, a nested relation to the CNPJ rule, by the target's title.
		expect(moc).toContain(
			"references → [[record-req-rn632504|Identificador do CNPJ da Escrituração]]",
		);
		// And the web HTML projects the same relation as a nested <li> with a link.
		const html = renderRequirementsMocHtml({
			by: "field:tipo",
			summary: { total: 1, byState: { draft: 1 } },
			groups: [
				{
					key: "caso-de-uso",
					label: "caso-de-uso",
					count: 1,
					records: [
						{
							id: "record:req-cdu282405",
							title: "Receber Aviso de Tratamento Manual",
							link: "cdu.md",
							relations: [{ type: "references", target: "record:req-rn632504" }],
						},
						{ id: "record:req-rn632504", title: "Identificador do CNPJ", link: "rn.md" },
					],
				},
			],
		} as never);
		expect(html).toContain('data-relation="references"');
		expect(html).toContain('href="rn.md"');
	});

	it("the requirements MOC is a navigable product, and reflects a correction", async () => {
		const reg = buildRegistry({ statePath: tempStatePath() });
		const before = await harness.runVerb(reg, "requirements");
		expect((before.moc as string).startsWith("# Mapa de Conteúdo — Requisitos")).toBe(true);
		// The summary line counts review states even though the body groups by type.
		expect(before.moc as string).toContain("Rascunhos a revisar");

		// The analyst reviews a draft requirement (persists via shared records deps).
		const corrected = await harness.runGroup(reg, "records", [
			"correct",
			"record:req-cdu282405",
			"reviewed",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe(`${DGK_COMMAND} records list`);
		expect(corrected.nextCommands).toEqual([`${DGK_COMMAND} records list`]);

		// After: the summary reflects the review (one more reviewed, one fewer draft).
		const after = await harness.runVerb(reg, "requirements");
		expect(after.moc as string).toContain("2 Requisitos revisados");
	});

	it("persists analyst corrections across separate CLI registries when state is configured", async () => {
		const statePath = tempStatePath();
		const corrected = await harness.runGroup(buildRegistry({ statePath }), "records", [
			"correct",
			"record:req-cdu282405",
			"reviewed",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe(`${DGK_COMMAND} records list`);

		const after = await harness.runVerb(buildRegistry({ statePath }), "requirements");
		const moc = after.moc as string;
		expect(moc).toContain("Receber Aviso de Tratamento Manual");
		// The base model always offers to open the bench; with drafts still pending review,
		// it also suggests reviewing the next one (the operator model points at pending work).
		expect(buildRequirementsBaseModel({ statePath }).nextCommands[0]).toBe(
			`${DGK_COMMAND} requirements --json`,
		);
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
			const spec = (await specRes.json()) as {
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
			host: { hostId: "test", data: { mocHtml: "<nav data-requirements-moc>REQ MAP</nav>" } },
		};
		const result = (await handle.call?.("renderHomesteadSurface", request)) as { html: string };
		expect(result.html).toContain("Bancada de Requisitos");
		expect(result.html).toContain("data-requirements-moc");
		expect(result.html).toContain("REQ MAP");
		// The requirements launcher card is present too.
		expect(result.html).toContain("requirements");
	});
});
