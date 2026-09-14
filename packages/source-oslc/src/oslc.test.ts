import { describe, expect, it } from "vitest";

import {
	createOslcCrawlExtractor,
	createOslcFetchDriver,
	extractOslcAttachmentRef,
	extractOslcRelationLinks,
	isOslcArtifactUrl,
	isOslcCollectionUrl,
	oslcPrimaryTextToMarkdown,
	oslcRequestHeaders,
	oslcResourceRefs,
	splitOslcResourceBlocks,
} from "./oslc.js";

/** Synthetic Jazz fixtures — no real vendor data. A folder listing pointing at two artifacts, and
 * an artifact carrying primaryText + a traceability link + an attachment. */
const ROOT = "https://alm.example/rm/folders/PROJ";
const ART_A = "https://alm.example/rm/resources/TX_10";
const ART_B = "https://alm.example/rm/resources/TX_11";

const FOLDER_BODY = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:resource="${ART_A}"/>
  <rdf:Description rdf:resource="${ART_B}"/>
</rdf:RDF>`;

const ARTIFACT_BODY = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:dcterms="http://purl.org/dc/terms/" xmlns:jazz_rm="http://jazz.net/ns/rm#"
  xmlns:oslc_rm="http://open-services.net/ns/rm#">
  <oslc_rm:Requirement rdf:about="${ART_A}">
    <dcterms:identifier>RN-1</dcterms:identifier>
    <dcterms:title>Regra Um</dcterms:title>
    <jazz_rm:primaryText><div><p>Corpo <strong>rico</strong>.</p></div></jazz_rm:primaryText>
    <oslc_rm:elaboratedBy rdf:resource="${ART_B}"/>
  </oslc_rm:Requirement>
</rdf:RDF>`;

const FILE_ARTIFACT_BODY = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:public_rm_10="http://www.ibm.com/xmlns/rdm/rdf/">
  <rdf:Description rdf:about="${ART_B}">
    <dcterms:title>anexo.pdf</dcterms:title>
    <public_rm_10:wrappedResource rdf:resource="https://alm.example/rm/bin/999"/>
    <public_rm_10:wrappedResourceContentType>application/pdf</public_rm_10:wrappedResourceContentType>
  </rdf:Description>
</rdf:RDF>`;

describe("source-oslc — generic OSLC/Jazz protocol toolkit", () => {
	it("builds the OSLC request contract, with a per-target Configuration-Context", () => {
		const base = oslcRequestHeaders(undefined);
		expect(base.Accept).toBe("application/rdf+xml");
		expect(base["OSLC-Core-Version"]).toBe("2.0");
		expect(base["Configuration-Context"]).toBeUndefined();

		const scoped = oslcRequestHeaders("https://alm.example/rm/cm/stream/7");
		expect(scoped["Configuration-Context"]).toBe("https://alm.example/rm/cm/stream/7");
	});

	it("fetch driver applies OSLC headers and turns a non-OK response into a re-auth signal", async () => {
		const seen: Record<string, string>[] = [];
		const driver = createOslcFetchDriver({
			fetchImpl: (async (_url: string, init: RequestInit) => {
				seen.push(init.headers as Record<string, string>);
				return new Response(ARTIFACT_BODY, { status: 200, headers: { "content-type": "application/rdf+xml" } });
			}) as unknown as typeof fetch,
		});
		const out = await driver({ url: ART_A, attributes: { streamURI: "S1" } });
		expect(out.body).toContain("oslc_rm:Requirement");
		expect(seen[0]?.["Configuration-Context"]).toBe("S1");

		const failing = createOslcFetchDriver({
			fetchImpl: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
		});
		await expect(failing({ url: ART_A })).rejects.toMatchObject({ status: 401 });
	});

	it("classifies artifact vs collection URLs (overridable heuristic)", () => {
		expect(isOslcArtifactUrl(ART_A)).toBe(true);
		expect(isOslcArtifactUrl(ROOT)).toBe(false);
		expect(isOslcCollectionUrl(ROOT)).toBe(true);
		expect(isOslcCollectionUrl(ART_A)).toBe(false);
	});

	it("collects resource refs and crawls a folder into its children, carrying the stream context", () => {
		expect(oslcResourceRefs(FOLDER_BODY)).toEqual([ART_A, ART_B]);

		const extract = createOslcCrawlExtractor({ streamURI: "S1" });
		const links = extract({ url: ROOT, body: FOLDER_BODY });
		expect(links.map((l) => l.url)).toEqual([ART_A, ART_B]);
		expect(links[0]?.attributes).toEqual({ streamURI: "S1" });

		// an artifact leaf yields no further links (it is parsed, not walked)
		expect(extract({ url: ART_A, body: ARTIFACT_BODY })).toEqual([]);
	});

	it("splits RDF into per-resource blocks and renders primaryText to Markdown", () => {
		const blocks = splitOslcResourceBlocks(ARTIFACT_BODY).filter((b) => b.includes("dcterms:identifier"));
		expect(blocks).toHaveLength(1);
		const md = oslcPrimaryTextToMarkdown(blocks[0]!);
		expect(md).toContain("rico");
	});

	it("extracts OSLC traceability links via the neutral predicate map", () => {
		const links = extractOslcRelationLinks(ARTIFACT_BODY);
		expect(links).toEqual([{ type: "elaborates", targetUri: ART_B }]);
	});

	it("extracts a Jazz file-artifact attachment coordinate", () => {
		const ref = extractOslcAttachmentRef(FILE_ARTIFACT_BODY);
		expect(ref).toEqual({
			wrappedResourceUri: "https://alm.example/rm/bin/999",
			contentType: "application/pdf",
			title: "anexo.pdf",
		});
		// a plain text artifact has no attachment
		expect(extractOslcAttachmentRef(ARTIFACT_BODY)).toBeUndefined();
	});
});
