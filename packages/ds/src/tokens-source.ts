// The DTCG (W3C Design Tokens) SOURCE layer for the ds-tokens:v1 contract. A theme is authored ONCE as a
// vendor-neutral DTCG token file (tokens/<name>.tokens.json); the CSS the web ships and the DsTheme object
// every non-CSS surface (TUI, agent) consumes are DERIVED from it. This inverts the old direction, where
// the CSS was the source and DsTheme was reverse-extracted by regex — closing the "tokens coupled to CSS"
// gap at the root while keeping refarm's own authorship of the projection.

import { REQUIRED_TOKENS, type DsToken, type DsTheme } from "./contract.js";

/** A single DTCG token — a design decision as a platform-agnostic (`$type`, `$value`) pair. `$value` is
 * the raw value string (a color like `#238636`, a dimension like `8px`, or, in v1, a raw CSS string for
 * composite types like shadow/fontFamily). */
export interface DtcgToken {
	$value: string;
	$type?: string;
	$description?: string;
}

/** A DTCG token file: flat contract-named tokens plus an optional top-level `$description`. Kept as a
 * loose index (a string `$description` sits beside `DtcgToken` leaves) so the file parses as-authored. */
export type DtcgTokenFile = { [key: string]: DtcgToken | string | undefined };

/** Flatten a DTCG token file to the surface-neutral `DsTheme` the contract, registry, and TUI projection
 * consume: keep `name → $value` for every contract token, dropping `$type`/`$description` metadata. Only
 * the `ds-tokens:v1` contract tokens are surfaced; anything else in the file is ignored. */
export function dtcgToDsTheme(file: DtcgTokenFile): Partial<DsTheme> {
	const out: Partial<Record<DsToken, string>> = {};
	for (const token of REQUIRED_TOKENS) {
		const entry = file[token];
		if (entry && typeof entry === "object" && typeof entry.$value === "string") {
			out[token] = entry.$value;
		}
	}
	return out as Partial<DsTheme>;
}
