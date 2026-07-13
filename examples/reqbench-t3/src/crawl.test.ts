import { HttpFetchError, type WebFetchDriver, type WebSourceSessionEvidence } from "@refarm.dev/source-web";
import { describe, expect, it } from "vitest";

import { crawlRequirements } from "./persona.js";

const session: WebSourceSessionEvidence = { kind: "authenticated", authenticated: true };

/** A fixture Jazz RM project: a root folder → two artifacts, one of them an RDF requirement. */
const ROOT = "https://alm.example/rm/folders/PROJ";
const ART_A = "https://alm.example/rm/resources/TX_10";
const ART_B = "https://alm.example/rm/resources/TX_11";

function rdfRequirement(about: string, id: string, title: string): string {
	return `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:dcterms="http://purl.org/dc/terms/"
         xmlns:jazz_rm="http://jazz.net/ns/rm#">
  <rdf:Description rdf:about="${about}">
    <dcterms:identifier>${id}</dcterms:identifier>
    <dcterms:title>${title}</dcterms:title>
    <rdf:type rdf:resource="http://jazz.net/ns/rm#BusinessRule"/>
    <jazz_rm:primaryText><div>Corpo de ${id}.</div></jazz_rm:primaryText>
  </rdf:Description>
</rdf:RDF>`;
}

/** The folder listing points at both artifacts via rdf:resource. */
const FOLDER_BODY = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:resource="${ART_A}"/>
  <rdf:Description rdf:resource="${ART_B}"/>
</rdf:RDF>`;

function projectDriver(overrides: Record<string, string> = {}): WebFetchDriver {
	const site: Record<string, string> = {
		[ROOT]: FOLDER_BODY,
		[ART_A]: rdfRequirement(ART_A, "RN-1", "Regra Um"),
		[ART_B]: rdfRequirement(ART_B, "RN-2", "Regra Dois"),
		...overrides,
	};
	return async (req) => {
		const body = site[req.url];
		if (body === undefined) throw new HttpFetchError(404, req.url);
		return { body, mediaType: "application/rdf+xml" };
	};
}

describe("crawlRequirements — whole-project scrape", () => {
	it("walks the folder to every artifact and ingests each requirement", async () => {
		const result = await crawlRequirements({
			fetcher: projectDriver(),
			seeds: [{ url: ROOT }],
			session,
			ref: "web:efd",
		});
		expect(result.records.map((r) => r.fields.externalKey).sort()).toEqual(["RN-1", "RN-2"]);
		// Root folder + 2 artifacts fetched.
		expect(result.seen).toBe(3);
		expect(result.truncated).toBe(false);
		// First run: every artifact is new (folder body has no requirement, still tracked).
		expect(result.sync.counts.new).toBe(3);
	});

	it("carries the streamURI onto discovered requests (Configuration-Context)", async () => {
		const seenHeaders: Array<Record<string, unknown> | undefined> = [];
		const base = projectDriver();
		const spy: WebFetchDriver = async (req) => {
			seenHeaders.push(req.attributes);
			return base(req);
		};
		await crawlRequirements({
			fetcher: spy,
			seeds: [{ url: ROOT, attributes: { streamURI: "urn:stream:efd" } }],
			session,
			ref: "web:efd",
			streamURI: "urn:stream:efd",
		});
		// The two discovered artifacts inherit the stream context from the extractor.
		const artifactCtx = seenHeaders.filter((a) => a?.streamURI === "urn:stream:efd");
		expect(artifactCtx.length).toBeGreaterThanOrEqual(2);
	});

	it("is incremental — a second run re-ingests only the CHANGED artifact", async () => {
		const first = await crawlRequirements({
			fetcher: projectDriver(),
			seeds: [{ url: ROOT }],
			session,
			ref: "web:efd",
		});
		// Second run: artifact B's body changed, A is identical.
		const second = await crawlRequirements({
			fetcher: projectDriver({ [ART_B]: rdfRequirement(ART_B, "RN-2", "Regra Dois REVISADA") }),
			seeds: [{ url: ROOT }],
			session,
			ref: "web:efd",
			priorManifest: first.manifest,
		});
		// A unchanged → skipped; B changed → re-parsed; the folder body is unchanged too.
		expect(second.sync.counts.unchanged).toBe(2); // root folder + artifact A
		expect(second.sync.counts.changed).toBe(1); // artifact B
		expect(second.records.map((r) => r.fields.externalKey)).toEqual(["RN-2"]);
		expect(second.records[0]?.fields.title).toBe("Regra Dois REVISADA");
	});

	it("bounds an unbounded project with maxPages and reports truncated", async () => {
		const result = await crawlRequirements({
			fetcher: projectDriver(),
			seeds: [{ url: ROOT }],
			session,
			ref: "web:efd",
			maxPages: 2,
		});
		expect(result.seen).toBeGreaterThan(2);
		expect(result.truncated).toBe(true);
	});
});
