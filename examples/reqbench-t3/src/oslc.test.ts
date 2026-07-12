import { describe, expect, it, vi } from "vitest";

import { createOslcFetchDriver, oslcRequestHeaders, parseRequirementsFromRdf } from "./oslc.js";

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
		// primaryText HTML is flattened to plain text (mentions CNPJ → enrichment can tag it).
		expect(rn?.fields.body).toContain("CNPJ");
		expect(rn?.fields.body).not.toContain("<b>");
		// the Jazz artifact URI is preserved on the record.
		expect(rn?.fields.artifactUri).toBe("https://alm.example/rm/resources/TX_10");
		expect(rn?.sourceRefs).toEqual(["web:efd"]);

		const cdu = records.find((r) => r.fields.externalKey === "CDU-282405");
		expect(cdu?.fields.tipo).toBe("caso-de-uso");
	});

	it("returns no records for RDF with no requirement resources", () => {
		const empty = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"></rdf:RDF>`;
		expect(parseRequirementsFromRdf(empty, { ref: "web:efd", location: "/x" })).toEqual([]);
	});
});
