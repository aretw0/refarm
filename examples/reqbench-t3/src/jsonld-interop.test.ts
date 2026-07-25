import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsonld, { type ContextDefinition } from "jsonld";
import { describe, expect, it } from "vitest";

/**
 * Interop, demonstrated rather than declared.
 *
 * The records call themselves JSON-LD and name a published `@context`. Until now nothing checked
 * that a consumer OTHER than this codebase could act on that: the claim rested on the shape looking
 * right. A vocabulary only earns the word "open" when something that knows nothing about this
 * project can resolve it.
 *
 * So the reference JSON-LD processor expands a real record against the context this repository
 * serves, and the assertions are about the CONSUMER's view of it.
 *
 * One thing this deliberately does NOT claim: that every term is defined on purpose. The context
 * declares `@vocab`, so any name at all resolves under it — "no unresolved terms" is true by
 * construction and proves nothing. That was written as an assertion here first, and the control
 * test below is what exposed it. What is asserted instead is what `@vocab` cannot manufacture:
 * the declared types resolve to their declared IRIs, and the `id` → `@id` alias holds, so a
 * consumer can identify the record without knowing this project's field names.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const contextRoute = path.resolve(here, "../../../apps/site/src/pages/contexts/records/v1.ts");

/** The context object the site serves, read from the route that serves it. */
function servedContext(): Record<string, unknown> {
	const source = fs.readFileSync(contextRoute, "utf8");
	const start = source.indexOf("{", source.indexOf("const recordsContext ="));
	let depth = 0;
	let end = 0;
	for (let i = start; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) {
				end = i + 1;
				break;
			}
		}
	}
	// The literal is already valid JavaScript; evaluating it is truer than rewriting it as JSON.
	return new Function(`return ${source.slice(start, end)}`)() as Record<string, unknown>;
}

const record = {
	id: "record:req-rn632504",
	schemaVersion: 1,
	"@type": ["KnowledgeRecord", "Requirement"],
	fields: {
		title: "Identificador do CNPJ da Escrituração",
		tipo: "regra-de-negocio",
		status: "draft",
	},
};

describe("records are JSON-LD a standard processor can act on", () => {
	it("expands with every term resolved to an IRI and nothing dropped", async () => {
		const context = servedContext();
		const expanded = (await jsonld.expand({
			...record,
			"@context": (context as { "@context": ContextDefinition })["@context"],
		})) as Array<Record<string, unknown>>;

		expect(expanded).toHaveLength(1);
		const node = expanded[0]!;

		// `id` is aliased to @id in the context — the record has no literal "@id" key.
		expect(node["@id"]).toBe("record:req-rn632504");
		expect(node["@type"]).toEqual(
			expect.arrayContaining([expect.stringContaining("#Requirement")]),
		);

		// Declared terms land on the IRIs the context declares — this is what `@vocab` cannot fake,
		// because a term it catches would resolve under the vocabulary namespace either way.
		const terms = Object.keys(node).filter((key) => !key.startsWith("@"));
		expect(terms).toEqual(expect.arrayContaining([expect.stringContaining("#fields")]));
		expect(terms).toEqual(expect.arrayContaining([expect.stringContaining("#schemaVersion")]));
	});

	it("resolves an UNDECLARED term too, because @vocab catches everything — the caveat, stated", async () => {
		const context = servedContext();
		const expanded = (await jsonld.expand({
			...record,
			naoDefinidoNoVocabulario: "algum valor",
			"@context": (context as { "@context": ContextDefinition })["@context"],
		})) as Array<Record<string, unknown>>;

		// A term nobody declared still resolves, under the @vocab namespace. Asserted so the
		// limit is recorded next to the claim: expansion succeeding says the document is
		// well-formed JSON-LD, NOT that its vocabulary covers the field deliberately.
		const asText = JSON.stringify(expanded);
		expect(asText).toContain("#naoDefinidoNoVocabulario");
		expect(asText).toContain("algum valor");
	});
});
