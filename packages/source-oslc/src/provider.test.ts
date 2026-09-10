import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { SOURCE_CAPABILITY } from "@refarm.dev/source-contract-v1";
import { afterAll, describe, expect, it } from "vitest";

import { createOslcSourceProvider } from "./provider.js";

const ART_RDF = `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  xmlns:dcterms="http://purl.org/dc/terms/" xmlns:oslc_rm="http://open-services.net/ns/rm#">
  <oslc_rm:Requirement rdf:about="https://alm.example/rm/resources/TX_10">
    <dcterms:identifier>RN-1</dcterms:identifier><dcterms:title>Regra Um</dcterms:title>
  </oslc_rm:Requirement>
</rdf:RDF>`;

const cacheRoots: string[] = [];
function tmpCache(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "oslc-provider-"));
	cacheRoots.push(dir);
	return dir;
}
afterAll(() => {
	for (const dir of cacheRoots) rmSync(dir, { recursive: true, force: true });
});

describe("source-oslc — createOslcSourceProvider (full source:v1 via source-web)", () => {
	it("advertises source:v1 and lists its OSLC targets via discover()", async () => {
		const provider = createOslcSourceProvider({
			cacheRoot: tmpCache(),
			targets: [
				{ identity: "efd", url: "https://alm.example/rm/query/efd", streamURI: "S-EFD", label: "EFD" },
				{ identity: "nfe", url: "https://alm.example/rm/query/nfe" },
			],
		});
		expect(provider.capability).toBe(SOURCE_CAPABILITY);
		expect(provider.kinds).toContain("local");

		const catalog = await provider.discover();
		expect(catalog.entries.map((e) => e.ref).sort()).toEqual(["web:efd", "web:nfe"]);
	});

	it("materializes an OSLC target through the OSLC driver — RDF Accept + per-target Configuration-Context", async () => {
		const seenHeaders: Record<string, string>[] = [];
		const provider = createOslcSourceProvider({
			cacheRoot: tmpCache(),
			egress: { allowedHosts: ["alm.example"] },
			targets: [{ identity: "efd", url: "https://alm.example/rm/query/efd", streamURI: "S-EFD" }],
			fetchImpl: (async (_url: string, init: RequestInit) => {
				seenHeaders.push(init.headers as Record<string, string>);
				return new Response(ART_RDF, { status: 200, headers: { "content-type": "application/rdf+xml" } });
			}) as unknown as typeof fetch,
		});

		const result = await provider.materialize("web:efd");
		expect(result.action).toBe("cloned");
		expect(result.location.kind).toBe("local");

		// the OSLC contract was applied on the wire, with the target's stream as Configuration-Context
		expect(seenHeaders[0]?.["Accept"]).toBe("application/rdf+xml");
		expect(seenHeaders[0]?.["OSLC-Core-Version"]).toBe("2.0");
		expect(seenHeaders[0]?.["Configuration-Context"]).toBe("S-EFD");

		// the fetched RDF landed in the snapshot the substrate wrote
		const body = readFileSync(path.join(result.location.path, "content.html"), "utf8");
		expect(body).toContain("oslc_rm:Requirement");

		const status = await provider.status("web:efd");
		expect(status.materialized).toBe(true);
	});

	it("a 401 from the ALM propagates as a recoverable re-auth signal (not a silent fallback)", async () => {
		const provider = createOslcSourceProvider({
			cacheRoot: tmpCache(),
			egress: { allowedHosts: ["alm.example"] },
			targets: [{ identity: "efd", url: "https://alm.example/rm/query/efd" }],
			fetchImpl: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
		});
		await expect(provider.materialize("web:efd")).rejects.toMatchObject({ status: 401 });
	});

	it("offline (no fetchImpl) replays the cached snapshot without a network call", async () => {
		const provider = createOslcSourceProvider({
			cacheRoot: tmpCache(),
			targets: [{ identity: "efd", url: "https://alm.example/rm/query/efd" }],
		});
		const first = await provider.materialize("web:efd");
		expect(first.action).toBe("cloned");
		const second = await provider.materialize("web:efd");
		expect(second.action).toBe("reused");
	});
});
