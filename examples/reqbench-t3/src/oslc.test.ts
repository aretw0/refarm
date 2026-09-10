import { describe, expect, it, vi } from "vitest";

import type { CrawledPage } from "@refarm.dev/source-web";

import { readProvenance } from "@refarm.dev/provenance-contract-v1";

import { loginUrlForTarget } from "./persona.js";
import {
	createOslcCrawlExtractor,
	createOslcFetchDriver,
	extractAttachmentRef,
	oslcRequestHeaders,
	parseRequirementsFromRdf,
} from "./oslc.js";

// A minimal but realistic Jazz RM RDF/XML document: two requirements (a business rule and a
// use case), each an rdf:Description carrying dcterms:identifier/title, a jazz_rm:primaryText
// HTML blob, and an rdf:type hinting the kind — the shape the real vault's parser reads.
const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dcterms="http://purl.org/dc/terms/"
         xmlns:jazz_rm="http://jazz.net/ns/rm#">
  <rdf:Description rdf:about="https://alm.example/rm/resources/TX_10">
    <dcterms:identifier>RN-632504</dcterms:identifier>
    <dcterms:title>Identificador do CNPJ da Escrituração</dcterms:title>
    <rdf:type rdf:resource="http://jazz.net/ns/rm#BusinessRule"/>
    <jazz_rm:primaryText><div>O <b>CNPJ</b> identifica a escrituração.</div></jazz_rm:primaryText>
  </rdf:Description>
  <rdf:Description rdf:about="https://alm.example/rm/resources/TX_11">
    <dcterms:identifier>CDU-282405</dcterms:identifier>
    <dcterms:title>Receber Aviso de Tratamento Manual</dcterms:title>
    <rdf:type rdf:resource="http://open-services.net/ns/rm#UseCase"/>
    <jazz_rm:primaryText>Fluxo do caso de uso.</jazz_rm:primaryText>
    <oslc_rm:elaboratedBy rdf:resource="https://alm.example/rm/resources/TX_10"/>
    <dcterms:references rdf:resource="https://alm.example/rm/resources/OUTSIDE_99"/>
  </rdf:Description>
</rdf:RDF>`;

describe("oslcRequestHeaders", () => {
	it("carries the OSLC RDF contract and the Configuration-Context from streamURI", () => {
		const h = oslcRequestHeaders("urn:stream:efd");
		expect(h.Accept).toBe("application/rdf+xml");
		expect(h["OSLC-Core-Version"]).toBe("2.0");
		expect(h["DoorsRP-Request-Type"]).toBe("private");
		expect(h["Configuration-Context"]).toBe("urn:stream:efd");
	});
	it("omits Configuration-Context when there is no streamURI", () => {
		expect(oslcRequestHeaders(undefined)["Configuration-Context"]).toBeUndefined();
	});
});

describe("createOslcFetchDriver", () => {
	it("GETs with OSLC headers + Configuration-Context from the target attributes", async () => {
		const fetchImpl = vi.fn<typeof fetch>(
			async () =>
				new Response(RDF, { status: 200, headers: { "content-type": "application/rdf+xml" } }),
		);
		const driver = createOslcFetchDriver({ fetchImpl });
		const out = await driver({
			url: "https://alm.example/rm/resources/TX_10",
			session: { kind: "authenticated", authenticated: true },
			attributes: { streamURI: "urn:stream:efd", componentURI: "urn:comp:efd" },
		});
		expect(out.mediaType).toBe("application/rdf+xml");
		const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>;
		expect(headers.Accept).toBe("application/rdf+xml");
		expect(headers["Configuration-Context"]).toBe("urn:stream:efd");
	});

	it("throws HttpFetchError with the status on a non-OK response (401 stays recoverable)", async () => {
		const fetchImpl = vi.fn(async () => new Response("expired", { status: 401 }));
		const driver = createOslcFetchDriver({ fetchImpl: fetchImpl as unknown as typeof fetch });
		await expect(
			driver({
				url: "https://alm.example/rm/resources/TX_10",
				session: { kind: "authenticated", authenticated: true },
			}),
		).rejects.toMatchObject({ status: 401 });
	});
});

describe("parseRequirementsFromRdf", () => {
	it("parses RDF/XML into typed requirement records (same shape as the HTML parser)", () => {
		const records = parseRequirementsFromRdf(RDF, { ref: "web:efd", location: "/x" }) as Array<{
			id: string;
			fields: Record<string, unknown>;
			sourceRefs?: string[];
		}>;
		expect(records).toHaveLength(2);

		const rn = records.find((r) => r.fields.externalKey === "RN-632504");
		expect(rn?.id).toBe("record:req-rn632504");
		expect(rn?.fields.tipo).toBe("regra-de-negocio");
		expect(rn?.fields.title).toBe("Identificador do CNPJ da Escrituração");
		// primaryText XHTML is rendered to Markdown — structure preserved (the <b> becomes
		// **CNPJ**, not a stripped tag), and enrichment still tags the CNPJ mention.
		expect(rn?.fields.body).toBe("O **CNPJ** identifica a escrituração.");
		expect(rn?.fields.body).not.toContain("<b>");
		// the Jazz artifact URI is preserved on the record.
		expect(rn?.fields.artifactUri).toBe("https://alm.example/rm/resources/TX_10");
		expect(rn?.sourceRefs).toEqual(["web:efd"]);
		// license/privacy are stamped on every OSLC pull too, not just the HTML-pull path
		// (provenance-contract-v1 lane, entry 8) — no longer silently absent from an RDF ingest.
		const rnProvenance = readProvenance(rn?.fields);
		expect(rnProvenance?.license).toBe("unknown");
		expect(rnProvenance?.privacy).toBe("internal");

		const cdu = records.find((r) => r.fields.externalKey === "CDU-282405");
		expect(cdu?.fields.tipo).toBe("caso-de-uso");
	});

	it("extracts OSLC-RM traceability links as relations (in-corpus resolved, external kept as URI)", () => {
		const records = parseRequirementsFromRdf(RDF, { ref: "web:efd", location: "/x" }) as Array<{
			fields: Record<string, unknown>;
			relations?: Array<{ type: string; target: string; attrs?: Record<string, unknown> }>;
		}>;
		const cdu = records.find((r) => r.fields.externalKey === "CDU-282405");
		// The elaboratedBy link points at TX_10, which IS in this document → resolved to its id.
		const elaborates = cdu?.relations?.find((rel) => rel.type === "elaborates");
		expect(elaborates?.target).toBe("record:req-rn632504");
		expect(elaborates?.attrs?.external).toBeUndefined();
		// The references link points OUTSIDE the pulled set → kept as a URI, stamped external.
		const references = cdu?.relations?.find((rel) => rel.type === "references");
		expect(references?.target).toBe("https://alm.example/rm/resources/OUTSIDE_99");
		expect(references?.attrs?.external).toBe(true);

		// The RN requirement has no outgoing links → no relations (not an empty array we must guard).
		const rn = records.find((r) => r.fields.externalKey === "RN-632504");
		expect(rn?.relations).toBeUndefined();
	});

	it("returns no records for RDF with no requirement resources", () => {
		const empty = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF>`;
		expect(parseRequirementsFromRdf(empty, { ref: "web:efd", location: "/x" })).toEqual([]);
	});
});

describe("createOslcCrawlExtractor — walking a Jazz RM project", () => {
	const page = (url: string, body: string): CrawledPage => ({ url, body, mediaType: "application/rdf+xml", depth: 0 });

	it("emits every referenced resource from a folder listing", () => {
		const extract = createOslcCrawlExtractor({ streamURI: "urn:stream:efd" });
		const folder = page(
			"https://alm.example/rm/folders/F1",
			`<rdf:RDF>
				<rdf:Description rdf:resource="https://alm.example/rm/folders/F2"/>
				<rdf:Description rdf:resource="https://alm.example/rm/resources/TX_10"/>
			</rdf:RDF>`,
		);
		const links = extract(folder);
		expect(links.map((l) => l.url)).toEqual([
			"https://alm.example/rm/folders/F2",
			"https://alm.example/rm/resources/TX_10",
		]);
		// Every discovered link carries the target's Configuration-Context.
		expect(links[0]?.attributes).toEqual({ streamURI: "urn:stream:efd" });
	});

	it("dedupes repeated resource references", () => {
		const extract = createOslcCrawlExtractor();
		const links = extract(
			page(
				"https://alm.example/rm/folders/F1",
				`<x rdf:resource="https://alm.example/rm/resources/TX_1"/>
				 <y rdf:resource="https://alm.example/rm/resources/TX_1"/>`,
			),
		);
		expect(links).toHaveLength(1);
	});

	it("does NOT walk an artifact leaf (its body is parsed, not crawled)", () => {
		const extract = createOslcCrawlExtractor();
		const artifact = page(
			"https://alm.example/rm/resources/TX_10",
			// even if the artifact body references others, a leaf is terminal for the crawl
			`<x rdf:resource="https://alm.example/rm/resources/TX_99"/>`,
		);
		expect(extract(artifact)).toEqual([]);
	});

	it("respects overridden artifact/collection tests", () => {
		const extract = createOslcCrawlExtractor({
			isArtifact: (u) => u.endsWith(".artifact"),
			isCollection: (u) => u.endsWith(".coll"),
		});
		// A ".coll" is walked; a ".artifact" is a leaf.
		expect(extract(page("root.coll", `<x rdf:resource="child.artifact"/>`))).toHaveLength(1);
		expect(extract(page("leaf.artifact", `<x rdf:resource="other"/>`))).toEqual([]);
	});
});

describe("extractAttachmentRef — a file artifact's wrapped binary", () => {
	it("extracts the wrappedResource URI, content type, and title", () => {
		const body = `<rdf:Description>
			<dcterms:title>diagrama-fluxo.png</dcterms:title>
			<public_rm_10:wrappedResource rdf:resource="https://alm.example/rm/resources/BIN_1"/>
			<public_rm_10:wrappedResourceContentType>image/png</public_rm_10:wrappedResourceContentType>
		</rdf:Description>`;
		expect(extractAttachmentRef(body)).toEqual({
			wrappedResourceUri: "https://alm.example/rm/resources/BIN_1",
			contentType: "image/png",
			title: "diagrama-fluxo.png",
		});
	});

	it("returns undefined for a plain text requirement (no wrappedResource)", () => {
		const body = `<rdf:Description><dcterms:title>Regra</dcterms:title></rdf:Description>`;
		expect(extractAttachmentRef(body)).toBeUndefined();
	});
});

describe("loginUrlForTarget — sign in at the app, not at a resource", () => {
	it("turns a Jazz resource URL into the application root", () => {
		expect(
			loginUrlForTarget({ url: "https://alm.example/rm/resources/TX_WA8C8CLlEfGnFu6QlLLI_A" }),
		).toBe("https://alm.example/rm/web");
	});

	it("honours a target's declared loginUrl over the derivation", () => {
		expect(
			loginUrlForTarget({
				url: "https://alm.example/rm/resources/TX_1",
				attributes: { loginUrl: "https://alm.example/custom/portal" },
			}),
		).toBe("https://alm.example/custom/portal");
	});

	it("falls back to the origin when the URL has no app segment", () => {
		expect(loginUrlForTarget({ url: "https://alm.example/" })).toBe("https://alm.example");
	});
});

describe("parseRequirementsFromRdf — tags carrying attributes", () => {
	// The shape a real Jazz RM server answers with: dcterms:identifier declares a datatype and
	// dcterms:title declares parseType. A regex anchored on `identifier>` instead of the opening
	// `<identifier` matches the CLOSING tag and captures the whitespace after it — the record then
	// arrives with an empty id. The offline fixture had bare tags, so this never surfaced.
	const rdf = `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
	xmlns:dcterms="http://purl.org/dc/terms/" xmlns:jazz_rm="http://jazz.net/ns/rm#">
	<rdf:Description rdf:about="https://alm.example/rm/resources/TX_ABC">
		<dcterms:identifier rdf:datatype="http://www.w3.org/2001/XMLSchema#string">989746</dcterms:identifier>
		<dcterms:title rdf:parseType="Literal">RN-Validar CNPJ</dcterms:title>
		<jazz_rm:primaryText rdf:parseType="Literal"><div xmlns="http://www.w3.org/1999/xhtml"><p>Validar o CNPJ conforme o layout.</p></div></jazz_rm:primaryText>
	</rdf:Description>
</rdf:RDF>`;

	it("reads the identifier from the opening tag, not the closing one", () => {
		const records = parseRequirementsFromRdf(rdf, {
			ref: "web:efd",
			url: "https://alm.example/rm/resources/TX_ABC",
			mediaType: "application/rdf+xml",
		} as never);

		expect(records).toHaveLength(1);
		expect(records[0]!.id).toContain("989746");
		expect(records[0]!.id).not.toMatch(/req-\s*$/);
	});

	it("reads the title through its parseType attribute", () => {
		const records = parseRequirementsFromRdf(rdf, {
			ref: "web:efd",
			url: "https://alm.example/rm/resources/TX_ABC",
			mediaType: "application/rdf+xml",
		} as never);

		expect(JSON.stringify(records[0])).toContain("RN-Validar CNPJ");
	});
});
