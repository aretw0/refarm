import { buildJsonErrorEnvelope, buildJsonSuccessEnvelope } from "@refarm.dev/capabilities/envelope";
import type { CapabilityDescriptor, CapabilityEnvelope, CapabilityInput } from "@refarm.dev/capabilities";
import type { RecordsCommandDeps } from "@refarm.dev/capability-host";
import { searchRecords, type SearchDispatcher } from "@refarm.dev/vault-contract-v1";

/**
 * The `requirements-search` verb, in its OWN browser-safe module. It is extracted from persona.ts
 * (which pulls node:crypto + the WASM vault-surface component at module load) so the WEB face can
 * import the search factory WITHOUT dragging node/WASM into the bundle — the same seam wallet-t2's
 * `@refarm.dev/wallet/browser` uses. persona.ts re-exports it, so the CLI is unchanged; the web
 * boot imports THIS file directly. Its deps are injected (records + a search dispatcher), and every
 * import here is browser-safe (envelope builders from capabilities/envelope, searchRecords from the
 * vault contract). The reference vault surface (no WASM) satisfies the search dispatcher in-browser.
 */

interface SearchResultRow {
	recordId: string;
	title: string;
	tipo?: string;
	sistema?: string;
	score: number;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Project the search results into a DS-styled list — the verb's OWN web render, painted by the
 * capability web surface's action-result region (declared via `renderers.web.resultField`). Facets
 * (tipo/sistema) ride along as a muted caption so an analyst sees WHY a hit matched. */
function renderSearchResultsHtml(query: string, results: SearchResultRow[]): string {
	if (results.length === 0) {
		return `<div class="refarm-stack" data-search-results data-match-count="0">
			<p class="refarm-note">Nenhum resultado para <strong>${escapeHtml(query)}</strong>.</p>
		</div>`;
	}
	const items = results
		.map((r) => {
			const facets = [r.tipo, r.sistema].filter(Boolean).map((f) => escapeHtml(String(f))).join(" · ");
			const caption = facets ? `<span class="refarm-card-summary">${facets}</span>` : "";
			return `<li data-record-id="${escapeHtml(r.recordId)}">
				<span class="refarm-card-name">${escapeHtml(r.title)}</span>
				${caption}
			</li>`;
		})
		.join("");
	return `<div class="refarm-stack" data-search-results data-match-count="${results.length}">
		<p class="refarm-note">${results.length} resultado(s) para <strong>${escapeHtml(query)}</strong>.</p>
		<ul class="refarm-list">${items}</ul>
	</div>`;
}

/** The T3 persona verb: `requirements-search <query> [--tipo --sistema]` — find requirements in
 * the vault by text, filtered by frontmatter facets. The analyst asks "where did I write about
 * nota fiscal?"; the SAME sovereign vault surface that ROUTES also SEARCHES (the query is data
 * the surface interprets). Thin BECAUSE the framework carries the search — one searchRecords call.
 * `--tipo`/`--sistema` post-filter the hit records by their frontmatter facet. The envelope also
 * carries `resultsHtml` (the verb's own render) so the web face paints matches in place. */
export function createRequirementsSearchCapability(
	recordsDeps: RecordsCommandDeps,
	vaultSurface: () => Promise<SearchDispatcher>,
): CapabilityDescriptor {
	return {
		name: "requirements-search",
		summary: "Search the requirements vault by text, filtered by tipo/sistema",
		args: [{ name: "query", required: true }],
		options: [
			// `tipo` is a closed taxonomy (see REQUIREMENTS_TAXONOMY) — declaring the enum makes the web
			// face render a <select> of the real types and the agent tool offer them, instead of a text
			// box you must know the values for.
			{
				name: "tipo",
				kind: "string",
				enum: ["regra-de-negocio", "funcional", "caso-de-uso"],
				summary: "Only requirements of this tipo",
			},
			{ name: "sistema", kind: "string", summary: "Only requirements of this sistema (e.g. EFD)" },
		],
		transports: { http: { path: "/requirements/search" } },
		renderers: {
			tui: { section: "requirements" },
			web: { route: "/search", icon: "search", resultField: "resultsHtml" },
		},
		async run(input: CapabilityInput): Promise<CapabilityEnvelope> {
			const query = String(input.args.query ?? "").trim();
			if (!query) {
				return buildJsonErrorEnvelope({
					command: "requirements-search",
					operation: "search",
					error: "no_query",
					message: "Pass a search query (e.g. requirements-search \"nota fiscal\").",
					nextAction: "requirements-search <query>",
				});
			}
			const manifest = recordsDeps.loadManifest();
			// Optional facet filter — narrow the corpus BEFORE searching (a real analyst scopes by
			// system/type). Applied to the records, not the query, so it composes with any term.
			// Case-INSENSITIVE: `sistema` is stored upper-cased and `tipo` lower-kebab, so `--sistema
			// efd` / `--tipo Funcional` must still match (else the analyst gets an empty result with
			// no error and assumes "nothing there").
			const tipo = input.options?.tipo ? String(input.options.tipo).toLowerCase() : undefined;
			const sistema = input.options?.sistema ? String(input.options.sistema).toLowerCase() : undefined;
			const scoped = manifest.records.filter(
				(r) =>
					(!tipo || String(r.fields?.tipo ?? "").toLowerCase() === tipo) &&
					(!sistema || String(r.fields?.sistema ?? "").toLowerCase() === sistema),
			);

			const hits = await searchRecords(await vaultSurface(), scoped, query);
			// One entry per matched record (a record can match several terms → dedup, keep best score).
			const byRecord = new Map<string, SearchResultRow>();
			for (const hit of hits) {
				const record = manifest.records.find((r) => r.id === hit.recordId);
				const existing = byRecord.get(hit.recordId);
				const score = (existing?.score ?? 0) + (hit.score ?? 1);
				byRecord.set(hit.recordId, {
					recordId: hit.recordId,
					title: String(record?.fields?.title ?? hit.recordId),
					tipo: record?.fields?.tipo ? String(record.fields.tipo) : undefined,
					sistema: record?.fields?.sistema ? String(record.fields.sistema) : undefined,
					score,
				});
			}
			// Most-relevant first (more matched terms = higher score).
			const results = [...byRecord.values()].sort((a, b) => b.score - a.score);

			return buildJsonSuccessEnvelope({
				command: "requirements-search",
				operation: "search",
				nextCommand: "dgk requirements",
				nextCommands: ["dgk requirements"],
				extra: {
					query,
					scope: { tipo, sistema, searched: scoped.length },
					matched: results.length,
					results,
					resultsHtml: renderSearchResultsHtml(query, results),
				},
			});
		},
	};
}
