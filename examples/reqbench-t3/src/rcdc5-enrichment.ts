/**
 * rcdc5's REAL enrichment, expressed as an `enrichment:v1` provider on the shared engine.
 *
 * This closes the synthetic→live gap for the ocamento (see docs/CONVERGENCE-LANE.md):
 * reqbench's own `REQ_ENRICHMENT_RULES` (persona.ts) are a synthetic "swap-for-yours"
 * fixture. Here we feed the SAME proven operate-surface — `createRulesEnrichmentProvider`
 * from `@refarm.dev/enrichment-contract-v1`, the engine the capability-host already drives —
 * rcdc5's ACTUAL production rules (its `.rm-enrichment.json`: CNPJ / CPF / integração),
 * and prove (in rcdc5-enrichment.parity.test.ts) that the generic engine's tag decisions are
 * byte-identical to rcdc5's own `@rcdcp/rm-enrichment` runner.
 *
 * Sovereign boundary: the ENGINE is generic (refarm); the RULES and the `rcdc5/` tag
 * vocabulary are rcdc5's product layer, carried here only as a labelled fixture — exactly as
 * workitem-task.test.ts carries `ccm_*`/`rcdc5_*` shapes to prove the boundary holds. Nothing
 * SERPRO-specific enters the generic contract.
 *
 * What rcdc5 keeps (its storage substrate, untouched by this slice): walking a directory of
 * markdown, the formatting-preserving `tags:` injection, disk write-back, the `rcdc5/` prefix
 * validation, the `rcdc5_*` preservation check. This module only lifts the DECISION —
 * "given a record's fields + current tags + rules, which tags to add" — onto the shared
 * `enrichment:v1` engine.
 */

import {
	createRulesEnrichmentProvider,
	type EnrichmentInput,
	type EnrichmentProvider,
	type EnrichmentResult,
	type EnrichmentRule,
} from "@refarm.dev/enrichment-contract-v1";

/**
 * rcdc5's REAL rules, verbatim from `rcdc5/.rm-enrichment.json`, mapped to the generic
 * `EnrichmentRule` shape. rcdc5's `matchPattern` is a string always compiled case-insensitive
 * (`new RegExp(pattern, "i")`), so we carry `matchFlags: "i"` — which is also the engine's
 * default for a string pattern, making the compiled RegExp identical on both sides.
 *
 * (rcdc5's config also carries a `guard` field per rule; its runner never reads it — it is
 * dead metadata — so parity does not depend on it and it is intentionally not mapped.)
 */
export const RCDC5_ENRICHMENT_RULES: EnrichmentRule[] = [
	{
		id: "tag-cnpj",
		matchSource: ["body", "title"],
		matchPattern: "\\bCNPJ\\b",
		matchFlags: "i",
		outputTag: "rcdc5/cnpj",
	},
	{
		id: "tag-cpf",
		matchSource: "body",
		matchPattern: "\\bCPF\\b",
		matchFlags: "i",
		outputTag: "rcdc5/cpf",
	},
	{
		id: "tag-integracao",
		matchSource: ["body", "alm_dashboard_terms"],
		matchPattern: "integra[çc][aã]o|webservice|web service|API|REST|SOAP",
		matchFlags: "i",
		outputTag: "rcdc5/integracao",
	},
];

/** The tag field rcdc5 injects into (`tags:` in the artifact frontmatter). */
export const RCDC5_TAG_FIELD = "tags";

// ─── rcdc5's exact extraction, replicated so the fields fed to the engine hold byte-identical
// text to what rcdc5's runner matches against. (Copied from @rcdcp/rm-enrichment/src/runner.ts
// + output.ts; the parity test pins that this stays faithful.) ────────────────────────────────

/** rcdc5's body extraction: everything after the frontmatter block. */
function extractBody(markdown: string): string {
	return markdown.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/)?.[1] ?? "";
}

/** rcdc5's scalar frontmatter read: `^<key>: "?value"?$` within the frontmatter block. */
function extractFrontmatterScalar(markdown: string, key: string): string | undefined {
	const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (frontmatter === undefined) return undefined;
	const pattern = new RegExp(`^${key}:\\s*"?([^"\\n]+)"?$`, "m");
	return frontmatter.match(pattern)?.[1]?.trim();
}

/** rcdc5's tag-array read from the `tags:` block (items with or without quotes). */
function extractTags(markdown: string): string[] {
	const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1];
	if (frontmatter === undefined) return [];
	const tagsBody = frontmatter.match(/(?:^|\n)tags:\n((?:[ \t]+-[^\n]*\n?)*)/)?.[1];
	if (tagsBody === undefined) return [];
	const result: string[] = [];
	for (const line of tagsBody.split("\n")) {
		const captured = line.match(/^\s+-\s+"?([^"\n]+?)"?\s*$/)?.[1];
		if (captured !== undefined) result.push(captured.trim());
	}
	return result;
}

/** Every distinct field the rules read (`body`, `title`, `alm_dashboard_terms`, …). */
const RULE_SOURCE_FIELDS = [
	...new Set(RCDC5_ENRICHMENT_RULES.flatMap((rule) => [rule.matchSource].flat())),
];

/**
 * Project one rcdc5 markdown artifact into an `enrichment:v1` `EnrichmentInput`. Each rule
 * source is materialised with rcdc5's OWN extraction so the text the engine matches is exactly
 * what rcdc5's runner would match; the current `tags:` become the tag field the engine reads
 * for idempotency and writes back into.
 */
export function rcdc5ArtifactToEnrichmentInput(id: string, markdown: string): EnrichmentInput {
	const fields: Record<string, unknown> = {};
	for (const source of RULE_SOURCE_FIELDS) {
		fields[source] = source === "body" ? extractBody(markdown) : extractFrontmatterScalar(markdown, source);
	}
	fields[RCDC5_TAG_FIELD] = extractTags(markdown);
	return { id, fields, sourceRef: id };
}

/**
 * rcdc5's enrichment as an `enrichment:v1` provider — the generic engine, rcdc5's rules. This
 * is the exact object the capability-host's records-enrich verb dispatches (`select` then
 * `enrich`), so wiring it into a host makes `refarm … enrich` operate rcdc5's enrichment.
 */
export function createRcdc5EnrichmentProvider(): EnrichmentProvider {
	return createRulesEnrichmentProvider({
		pluginId: "@rcdcp/rm-enrichment",
		providerId: "rcdc5.rm-enrichment",
		tagField: RCDC5_TAG_FIELD,
		rules: RCDC5_ENRICHMENT_RULES,
	});
}

/**
 * Operate entry: enrich a batch of rcdc5 markdown artifacts through the shared engine, exactly
 * as the runtime would (filter to candidates via `select`, then `enrich`). Returns the
 * `enrichment:v1` result (changes + diagnostics) — the decision only; writing the added tags
 * back to disk remains rcdc5's storage-substrate responsibility.
 */
export async function enrichRcdc5Artifacts(
	artifacts: ReadonlyArray<{ id: string; markdown: string }>,
	options: { mode?: "dry-run" | "apply" } = {},
): Promise<EnrichmentResult> {
	const provider = createRcdc5EnrichmentProvider();
	const inputs = artifacts.map((artifact) => rcdc5ArtifactToEnrichmentInput(artifact.id, artifact.markdown));
	const candidates = provider.select(inputs);
	return provider.enrich(candidates, { mode: options.mode ?? "dry-run" });
}
