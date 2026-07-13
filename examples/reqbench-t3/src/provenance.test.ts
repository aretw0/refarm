import { readProvenance, verifyProvenance } from "@refarm.dev/provenance-contract-v1";
import { describe, expect, it } from "vitest";

import { reqManifest } from "./fixture.js";
import { parseRequirementsFromHtml } from "./persona.js";
import { parseRequirementsFromRdf } from "./oslc.js";

/**
 * T3 consumes provenance:v1: every ingested requirement records WHERE it came from, so the
 * analyst's product is auditable. Proven for both parse paths (HTML fixture + live RDF/OSLC)
 * and the seed corpus.
 */

const context = { ref: "web:reqbench-alm", location: "/snap/reqbench-alm", mediaType: "text/html" };

describe("requirement provenance (HTML pull)", () => {
	it("stamps channel/origin/collectedAt/sha256 on each parsed record", () => {
		const body = `<article data-req="REQ-1" data-type="funcional" data-title="Título">corpo</article>`;
		const [record] = parseRequirementsFromHtml(body, context);
		const prov = readProvenance(record!.fields as Record<string, unknown>);
		expect(prov?.channel).toBe("requirements-pull");
		expect(prov?.originLink).toBe("web:reqbench-alm");
		expect(prov?.sourcePath).toBe("/snap/reqbench-alm");
		expect(prov?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
		expect(verifyProvenance(prov).valid).toBe(true);
	});
});

describe("requirement provenance (live RDF/OSLC pull)", () => {
	it("uses the artifact's Jazz URI as the origin link", () => {
		const body = `<oslc_rm:Requirement rdf:about="https://alm.example/rm/42">
			<dcterms:identifier>REQ-42</dcterms:identifier>
			<dcterms:title>Um requisito</dcterms:title>
		</oslc_rm:Requirement>`;
		const [record] = parseRequirementsFromRdf(body, { ...context, mediaType: "application/rdf+xml" });
		const prov = readProvenance(record!.fields as Record<string, unknown>);
		expect(prov?.channel).toBe("requirements-pull");
		expect(prov?.originLink).toBe("https://alm.example/rm/42");
		expect(verifyProvenance(prov).valid).toBe(true);
	});
});

describe("seed corpus provenance", () => {
	it("the already-pulled seed records also carry provenance", () => {
		const manifest = reqManifest();
		for (const record of manifest.records) {
			const prov = readProvenance(record.fields as Record<string, unknown>);
			expect(prov?.channel).toBe("requirements-pull");
			expect(verifyProvenance(prov).valid).toBe(true);
		}
	});
});

describe("requirements-organize (PARA routing via vault:v1)", () => {
	it("routes seed requirements to PARA areas by tipo", async () => {
		const { createRequirementsOrganizeCapability, reqCapabilityBundle } = await import("./persona.js");
		const { records } = reqCapabilityBundle();
		const verb = createRequirementsOrganizeCapability(records);
		const env = (await verb.run!({ args: {}, options: {}, json: true })) as Record<string, unknown>;
		expect(env.ok).toBe(true);
		const plans = env.plans as { id: string; destination: string }[];
		const byId = Object.fromEntries(plans.map((p) => [p.id, p.destination]));
		// regra-de-negocio + funcional → Resources; caso-de-uso → Projects (the taxonomy data).
		expect(byId["record:req-rn632504"]).toBe("40 - Resources");
		expect(byId["record:req-cdu282405"]).toBe("20 - Projects");
	});
});
