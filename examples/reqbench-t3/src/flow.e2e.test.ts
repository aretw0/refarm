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
	createRequirementsPullCapability,
	createRequirementsSourceProvider,
	parseRequirements,
	parseRequirementsFromHtml,
	renderRequirementsGraphSvg,
	renderRequirementsMocHtml,
	reqCapabilityBundle,
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

	it("DOGFOOD: the journey runs as a declarative playbook (discover → pull, threaded)", async () => {
		// The whole T3 journey expressed as `.dgk/requirements-sync.playbook.json` and run through
		// the generic @refarm.dev/playbook engine driving the reqbench's OWN verbs in-process:
		// `source:discover` lists the systems, its result THREADS the ref into
		// `requirements:requirements-pull`, which ingests. One framework verb, the real journey.
		const statePath = tempStatePath();
		const host = buildReqbenchHost({ statePath });
		const playbook = host.registry().get("playbook-run");
		if (!playbook || "actions" in playbook) throw new Error("playbook-run verb not mounted");

		const res = (await playbook.run({
			args: { playbook: "requirements-sync" },
			options: {},
			json: true,
		})) as unknown as {
			ok: boolean;
			playbook: string;
			steps: Array<{ verb: string; ok: boolean }>;
			bindings: {
				discovered: { sources: Array<{ ref: string }> };
				pulled: { ref: string; ingested: number };
			};
		};

		expect(res.ok).toBe(true);
		expect(res.playbook).toBe("requirements-sync");
		expect(res.steps.map((s) => s.verb)).toEqual([
			"source:discover",
			"requirements:requirements-pull",
		]);
		expect(res.steps.every((s) => s.ok)).toBe(true);
		// The ref was THREADED from discovery into the pull (not hardcoded in the pull step).
		const discoveredRef = res.bindings.discovered.sources[0]?.ref;
		expect(discoveredRef).toBe(REQ_SYSTEM_REF);
		expect(res.bindings.pulled.ref).toBe(discoveredRef);
		expect(res.bindings.pulled.ingested).toBe(3);

		// And the pull actually persisted: a fresh registry over the SAME state sees the reqs.
		const after = await harness.runVerb(buildRegistry({ statePath }), "requirements");
		expect(after.moc as string).toContain("Identificador do CNPJ da Escrituração");
	});

	it("the playbook-run verb is surfaced as an agent tool", () => {
		const host = buildReqbenchHost({ statePath: tempStatePath() });
		const playbook = host.registry().get("playbook-run");
		if (!playbook || "actions" in playbook) throw new Error("playbook-run verb not mounted");
		expect(playbook.transports?.agent).toMatchObject({ tool: true });
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

	it("MULTI-SOURCE: aggregates two systems in one vault and organizes each by its `sistema`", async () => {
		// The analyst works across MORE than one ALM. Pull EFD and NFE into the same vault; each
		// requirement is stamped with its source system, and the taxonomy routes each system's
		// requirements into its own project area — the `sistema` axis, now live.
		const statePath = tempStatePath();
		const pull = buildRegistry({ statePath }).get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("requirements-pull verb not mounted");
		await pull.run({ args: { ref: "web:efd" }, options: {}, json: true });
		await pull.run({ args: { ref: "web:nfe" }, options: {}, json: true });

		// Both systems' requirements now live in ONE vault (3 EFD + 2 NFE = 5).
		const wallet = await harness.runVerb(buildRegistry({ statePath }), "requirements");
		expect(wallet.total).toBe(5);

		// Each record carries its source system (the previously-inert field, now stamped).
		const organize = buildRegistry({ statePath }).get("requirements-organize");
		if (!organize || "actions" in organize) throw new Error("requirements-organize verb not mounted");
		const routed = (await organize.run({ args: {}, options: {}, json: true })) as unknown as {
			plans: Array<{ id: string; destination: string }>;
		};
		const byId = Object.fromEntries(routed.plans.map((p) => [p.id, p.destination]));
		// EFD requirements route into the EFD area, NFE into the NFE area — grouped by system.
		expect(byId["record:req-rn632504"]).toBe("20 - Projects/EFD");
		expect(byId["record:req-rn771002"]).toBe("20 - Projects/NFE");
		expect(byId["record:req-fun771050"]).toBe("20 - Projects/NFE");
		// A facet-scoped search confirms the aggregation: only NFE requirements when scoped to it.
		const searchVerb = buildRegistry({ statePath }).get("requirements-search");
		if (!searchVerb || "actions" in searchVerb) throw new Error("requirements-search verb not mounted");
		const nfeHits = (await searchVerb.run({
			args: { query: "nota fiscal" },
			options: { sistema: "NFE" },
			json: true,
		})) as unknown as { results: Array<{ recordId: string }>; scope: { searched: number } };
		expect(nfeHits.scope.searched).toBe(2); // only the 2 NFE records were searched
	});

	it("`requirements-graph` projects the graph DATA (for the interactive web face) + an SVG", async () => {
		// Pull records, then run the graph verb — it must expose the raw {nodes,links} + labels the
		// web face mounts interactively (mountGraph), not only the static SVG string.
		const statePath = tempStatePath();
		const pull = buildRegistry({ statePath }).get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("requirements-pull verb not mounted");
		await pull.run({ args: { ref: REQ_SYSTEM_REF }, options: {}, json: true });

		const graphVerb = buildRegistry({ statePath }).get("requirements-graph");
		if (!graphVerb || "actions" in graphVerb) throw new Error("requirements-graph verb not mounted");
		const res = (await graphVerb.run({ args: {}, options: {}, json: true })) as unknown as {
			total: number;
			svg: string;
			graph: { nodes: Array<{ id: string }>; links: unknown[] };
			labels: Record<string, string>;
		};
		expect(res.total).toBe(3);
		// The static SVG face.
		expect(res.svg).toContain("<svg");
		// The DATA face: {nodes,links} + labels the client mounts interactively.
		expect(res.graph.nodes).toHaveLength(3);
		expect(Object.values(res.labels)).toContain("RN-632504");
	});

	it("`requirements-lab` emits an artifact:v1 manifest with the Marimo→WASM export command", async () => {
		// Pull records, then run the lab verb — it publishes the graph as a dataset and emits the
		// artifact manifest (dataset + notebook, with the real marimo export recorded as provenance).
		const statePath = tempStatePath();
		const pull = buildRegistry({ statePath }).get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("requirements-pull verb not mounted");
		await pull.run({ args: { ref: REQ_SYSTEM_REF }, options: {}, json: true });

		const labVerb = buildRegistry({ statePath }).get("requirements-lab");
		if (!labVerb || "actions" in labVerb) throw new Error("requirements-lab verb not mounted");
		const res = (await labVerb.run({ args: {}, options: {}, json: true })) as unknown as {
			nodeCount: number;
			artifacts: Array<{ id: string; role: string }>;
			exports: string[];
			manifest: { schema: string; artifacts: unknown[] };
		};
		expect(res.nodeCount).toBe(3);
		// A valid artifact:v1 manifest: the dataset + the notebook.
		expect(res.manifest.schema).toBe("sovereign.task-artifacts.v1");
		expect(res.artifacts.map((a) => a.role).sort()).toEqual(["dataset", "report"]);
		// The exact Marimo→WASM export command a runner would execute.
		expect(res.exports[0]).toContain("marimo export html-wasm lab/analise-grafo.py");
	});

	it("`requirements-search` finds requirements by text over the sovereign vault surface", async () => {
		// Pull the corpus, then search it — the same surface that ROUTES (organize) also SEARCHES.
		const statePath = tempStatePath();
		const pull = buildRegistry({ statePath }).get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("requirements-pull verb not mounted");
		await pull.run({ args: { ref: REQ_SYSTEM_REF }, options: {}, json: true });

		const searchVerb = buildRegistry({ statePath }).get("requirements-search");
		if (!searchVerb || "actions" in searchVerb) throw new Error("requirements-search verb not mounted");

		// "CNPJ" appears in all three requirements (in a title, a body, or a section paragraph).
		const cnpj = (await searchVerb.run({ args: { query: "CNPJ" }, options: {}, json: true })) as unknown as {
			ok: boolean;
			matched: number;
			results: Array<{ recordId: string; title: string; tipo?: string }>;
		};
		expect(cnpj.ok).toBe(true);
		expect(cnpj.matched).toBe(3);
		expect(cnpj.results.some((r) => r.title.includes("CNPJ"))).toBe(true);
		// A term that is NOT in the corpus matches nothing.
		const none = (await searchVerb.run({ args: { query: "blockchain" }, options: {}, json: true })) as unknown as {
			matched: number;
		};
		expect(none.matched).toBe(0);

		// Facet filter: the same query, scoped to tipo=funcional → only the credit-selection req.
		const scoped = (await searchVerb.run({
			args: { query: "CNPJ" },
			options: { tipo: "funcional" },
			json: true,
		})) as unknown as { matched: number; scope: { searched: number } };
		expect(scoped.matched).toBe(1);
		expect(scoped.scope.searched).toBe(1); // only one funcional record was even searched

		// An empty query is a helpful error, not a crash.
		const empty = (await searchVerb.run({ args: { query: "  " }, options: {}, json: true })) as unknown as {
			ok: boolean;
			error: string;
		};
		expect(empty.ok).toBe(false);
		expect(empty.error).toBe("no_query");
	});

	it("`requirements-health` audits the corpus (orphans / duplicates / dangling links)", async () => {
		const statePath = tempStatePath();
		const healthVerb = buildRegistry({ statePath }).get("requirements-health");
		if (!healthVerb || "actions" in healthVerb) throw new Error("requirements-health verb not mounted");

		// The seed corpus: two requirements reference the CNPJ business rule (RN-632504), so the
		// three are connected in the traceability graph — no orphans, no dangling, no duplicates.
		const seed = (await healthVerb.run({ args: {}, options: {}, json: true })) as unknown as {
			ok: boolean;
			total: number;
			healthy: boolean;
			counts: { orphan: number; duplicate: number; "dangling-relation": number };
		};
		expect(seed.ok).toBe(true);
		expect(seed.total).toBe(3);
		expect(seed.healthy).toBe(true);
		expect(seed.counts.orphan).toBe(0);
		expect(seed.counts.duplicate).toBe(0);
		expect(seed.counts["dangling-relation"]).toBe(0);
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

	it("`--live` errors helpfully when no browser driver is wired (offline build)", async () => {
		// A build with no liveProviderFactory (e.g. no Chrome) must not pretend to scrape live.
		const reg = buildRegistry({ statePath: tempStatePath() });
		const pull = reg.get("requirements-pull");
		if (!pull || "actions" in pull) throw new Error("verb not mounted");
		// buildRegistry DOES wire a factory (puppeteer), so build a bare verb with none here.
		const bareRecords = { loadManifest: () => ({ records: [] }) } as unknown as Parameters<
			typeof createRequirementsPullCapability
		>[0];
		const bare = createRequirementsPullCapability(bareRecords, createRequirementsSourceProvider());
		if ("actions" in bare) throw new Error("verb");
		const res = (await bare.run({
			args: { ref: REQ_SYSTEM_REF },
			options: { live: true },
			json: true,
		})) as unknown as { ok: boolean; error?: string };
		expect(res.ok).toBe(false);
		expect(res.error).toBe("live_unavailable");
	});

	it("`--live` routes to the live provider (proven with a fake factory, no real browser)", async () => {
		// With a factory wired, --live uses IT (not the offline fixture provider). We inject a
		// fake factory returning a provider whose fetch is a canned RDF response — proving the
		// wiring end-to-end without a real Chrome (there is none in this container).
		const rdf = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:jazz_rm="http://jazz.net/ns/rm#">
			<rdf:Description rdf:about="https://alm.example/rm/resources/TX_10">
				<dcterms:identifier>RN-LIVE</dcterms:identifier>
				<dcterms:title>Regra viva</dcterms:title>
				<rdf:type rdf:resource="http://jazz.net/ns/rm#BusinessRule"/>
			</rdf:Description>
		</rdf:RDF>`;
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reqbench-live-flag-"));
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
		const liveFactory = vi.fn(async () =>
			createRequirementsSourceProvider({
				cacheRoot: dir,
				sourcesConfigPath: configPath,
				fetchImpl: (async () =>
					new Response(rdf, {
						status: 200,
						headers: { "content-type": "application/rdf+xml" },
					})) as unknown as typeof fetch,
			}),
		);
		try {
			const bundle = reqCapabilityBundle({
				statePath: tempStatePath(),
				sourcesConfigPath: configPath,
			});
			const verb = createRequirementsPullCapability(bundle.records, bundle.sourceProvider, {
				sourcesConfigPath: configPath,
				liveProviderFactory: liveFactory,
			});
			if ("actions" in verb) throw new Error("verb");
			const res = (await verb.run({
				args: { ref: REQ_SYSTEM_REF },
				options: { live: true },
				json: true,
			})) as unknown as { ok: boolean; live: boolean; ingested: number };
			expect(liveFactory).toHaveBeenCalledOnce(); // --live used the factory
			expect(res.live).toBe(true);
			expect(res.ingested).toBe(1); // the live RDF was ingested (RN-LIVE)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
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
		// The EXPIRED-session fetch always 401s (stale cookies). Re-auth must produce a NEW fetch
		// (fresh cookies from a fresh browser login) that succeeds — this proves the recovery
		// swaps the transport, not just the session evidence (the real bug the vault avoids).
		const staleFetch = vi.fn<typeof fetch>(
			async () => new Response("session expired", { status: 401 }),
		);
		const freshFetch = vi.fn<typeof fetch>(
			async () =>
				new Response(rdf, { status: 200, headers: { "content-type": "application/rdf+xml" } }),
		);
		const reauthenticate = vi.fn(async () => freshFetch); // re-login → fresh cookie fetch
		try {
			const provider = createRequirementsSourceProvider({
				cacheRoot: dir,
				sourcesConfigPath: configPath,
				fetchImpl: staleFetch,
				reauthenticate,
			});
			const ingested = await ingestSourceToRecords({
				sourceProvider: provider,
				ref: REQ_SYSTEM_REF,
				parse: parseRequirements,
				offline: false,
			});
			expect(staleFetch).toHaveBeenCalledOnce(); // 401 on the stale cookies
			expect(reauthenticate).toHaveBeenCalledOnce(); // re-opened the browser for fresh cookies
			expect(freshFetch).toHaveBeenCalledOnce(); // retried with the FRESH fetch → 200
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

	it("renders the requirement network as a force-directed SVG with edges from relations", () => {
		const svg = renderRequirementsGraphSvg({
			by: "field:tipo",
			summary: { total: 2, byState: { draft: 2 } },
			groups: [
				{
					key: "caso-de-uso",
					label: "caso-de-uso",
					count: 2,
					records: [
						{
							id: "record:req-cdu282405",
							title: "Receber Aviso de Tratamento Manual",
							link: "cdu.md",
							fields: { externalKey: "CDU-282405", body: "aplica [[RN-632504]]" },
							relations: [{ type: "references", target: "record:req-rn632504" }],
						},
						{
							id: "record:req-rn632504",
							title: "Identificador do CNPJ",
							link: "rn.md",
							fields: { externalKey: "RN-632504", body: "" },
						},
					],
				},
			],
		} as never);
		expect(svg).toContain("<svg");
		expect(svg).toContain("Rede de Requisitos (2)");
		// Two nodes drawn, labelled by their external keys.
		expect((svg.match(/<circle/g) ?? []).length).toBe(2);
		expect(svg).toContain(">CDU-282405<");
		expect(svg).toContain(">RN-632504<");
		// The relation (and the wikilink) become an edge — the network is connected.
		expect((svg.match(/<line/g) ?? []).length).toBeGreaterThanOrEqual(1);
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
