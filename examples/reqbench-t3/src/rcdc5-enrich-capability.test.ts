import { dispatchCapability } from "@refarm.dev/capabilities";
import { describe, expect, it } from "vitest";
import { createRcdc5EnrichCapability, type Rcdc5Artifact } from "./rcdc5-enrich-capability.js";

/**
 * DISPATCH PROOF — refarm's runtime operates rcdc5's enrichment end-to-end.
 *
 * `dispatchCapability(entry, tokens)` is the ONE resolve→validate→run path every actuated
 * surface (CLI, TUI, REPL, HTTP) routes through. Driving `rcdc5-enrich` through it — not a bare
 * `run()` — proves the runtime parses tokens, validates against the verb's derived schema, and
 * runs rcdc5's real enrichment (rules on the shared enrichment:v1 engine), returning the tag
 * decisions + provenance. This is C rung 2: the operate loop closed, without touching rcdc5.
 */

function makeMarkdown(title: string, body: string, tags: string[] = ["req/placeholder"]): string {
	const tagsYaml = `tags:\n${tags.map((t) => `  - ${t}`).join("\n")}`;
	return `---\ntitle: ${title}\n${tagsYaml}\n---\n${body}`;
}

const ARTIFACTS: Rcdc5Artifact[] = [
	{ id: "CDU001", markdown: makeMarkdown("Consultar contribuinte", "O sistema valida o CNPJ informado.") },
	{ id: "CDU002", markdown: makeMarkdown("Integração fiscal", "Expõe uma API REST para consulta.") },
	{ id: "CDU003", markdown: makeMarkdown("Relatório", "Apenas apresenta um relatório simples.") },
];

describe("rcdc5-enrich is operated by the refarm runtime (dispatch proof)", () => {
	it("dispatchCapability resolves→validates→runs rcdc5's enrichment and returns the tag decisions", async () => {
		const cap = createRcdc5EnrichCapability({ loadArtifacts: () => ARTIFACTS });

		const outcome = await dispatchCapability(cap, []); // no tokens → dry-run

		expect(outcome.status).toBe("ran");
		const env = outcome.envelope as {
			mode: string;
			total: number;
			enriched: number;
			tagged: Array<{ id: string; tags: string[]; ruleId?: string }>;
		};
		expect(env.mode).toBe("dry-run");
		expect(env.total).toBe(3);
		expect(env.enriched).toBe(2); // CDU001 (cnpj) + CDU002 (integração); CDU003 nothing

		const cnpj = env.tagged.find((t) => t.id === "CDU001");
		expect(cnpj?.tags).toContain("rcdc5/cnpj");
		expect(cnpj?.ruleId).toBe("tag-cnpj"); // provenance names the rule that fired

		const integ = env.tagged.find((t) => t.id === "CDU002");
		expect(integ?.tags).toContain("rcdc5/integracao");

		expect(env.tagged.some((t) => t.id === "CDU003")).toBe(false); // no match → not in the list
	});

	it("the runtime parses --apply from tokens (option coercion) and labels an apply run", async () => {
		const cap = createRcdc5EnrichCapability({ loadArtifacts: () => ARTIFACTS });

		const outcome = await dispatchCapability(cap, ["--apply"]);

		expect(outcome.status).toBe("ran");
		expect((outcome.envelope as { mode: string }).mode).toBe("apply");
	});

	it("the verb is a real mountable capability (name + http transport the host surfaces)", () => {
		const cap = createRcdc5EnrichCapability({ loadArtifacts: () => [] });
		expect(cap.name).toBe("rcdc5-enrich");
		expect(cap.transports?.http?.path).toBe("/rcdc5/enrich");
		expect(typeof cap.run).toBe("function");
	});
});
