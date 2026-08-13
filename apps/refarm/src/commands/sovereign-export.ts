/**
 * WHAT A BACKUP MUST CARRY, WHAT IT MUST NOT, AND WHAT IT CANNOT.
 *
 * ISS-123's second gap. `refarm context --inventory` answers what a node HOLDS; this answers what
 * a copy of it must CONTAIN, which is a different and smaller thing.
 *
 * ## A backup of a node is not a copy of a node
 *
 * The inventory classifies recoverability, and a naive export would carry everything marked
 * irrecoverable. That is wrong in both directions at once.
 *
 * `~/.silo/identity.json` is irrecoverable — and it is also a live credential file. Carrying it
 * turns the backup into a secret: sync it to a phone, a cloud drive, a second machine, and the
 * OAuth tokens go with it. But NOT carrying it loses the operator's model route, which is the
 * decision that took him time and which no login rebuilds. The file is two things.
 *
 * So the export SPLITS it. The decisions travel in the clear (which provider, which model, which
 * fallback, which base URL); the secrets do not travel at all — the manifest records WHICH
 * credentials to re-obtain and leaves the obtaining to a login. A backup you can email yourself is
 * worth more than one you dare not move, and re-authenticating is a minute.
 *
 * ## Four dispositions, and the fourth is the honest one
 *
 * `carry` — irrecoverable, declared, not secret. The bytes go in the bundle.
 * `re-authenticate` — the value returns from a login. The manifest names the provider; no secret.
 * `skip` — recoverable from git/npm/a rebuild, or a managed cache. Named with its source.
 * `undecidable` — the inventory could not classify it, or nothing declared points at it. NOT
 *   carried and NOT dismissed: listed, with the reason, so the operator decides. On his node that
 *   is 84 unclassified entries and 72 undeclared-irrecoverable ones — a number too large to carry
 *   blindly and too large to drop blindly, which is exactly why it is its own word.
 */
import path from "node:path";

import type { InventoryEntry } from "./sovereign-inventory.js";

export type ExportDisposition = "carry" | "re-authenticate" | "skip" | "undecidable";

export interface ExportPlanEntry {
	readonly file: string;
	readonly disposition: ExportDisposition;
	readonly reason: string;
	/** Bytes, when the inventory measured them. `null` stays null — never rounded to 0. */
	readonly bytes: number | null;
}

/**
 * Keys inside the silo that are DECISIONS rather than secrets.
 *
 * An allowlist, never a denylist. A new secret added to the silo must not travel because nobody
 * remembered to exclude it; with an allowlist, a new key is simply not carried until someone
 * decides it is safe. That default is the whole point.
 */
export const SILO_DECISION_KEYS = [
	"modelProvider",
	"modelId",
	"modelBaseUrl",
	"modelFallbackProvider",
	"modelFallbackModelId",
	"modelRoutes",
	"oauthProvider",
	"githubOwner",
] as const;

/** PURE. The non-secret decisions worth carrying out of a silo, and which credentials to re-obtain. */
export function splitSiloContent(tokens: Record<string, unknown>): {
	decisions: Record<string, unknown>;
	reAuthenticate: string[];
} {
	const decisions: Record<string, unknown> = {};
	for (const key of SILO_DECISION_KEYS) {
		if (tokens[key] !== undefined) decisions[key] = tokens[key];
	}
	const oauth = tokens.oauthCredentials;
	const providers = new Set<string>();
	if (oauth && typeof oauth === "object" && !Array.isArray(oauth)) {
		for (const provider of Object.keys(oauth)) providers.add(provider);
	}
	// An API key is a credential too, and its provider is the one the route names. Recorded as
	// something to re-obtain rather than carried, same as an OAuth token.
	if (typeof tokens.modelApiKey === "string" && typeof tokens.modelProvider === "string") {
		providers.add(tokens.modelProvider);
	}
	if (typeof tokens.githubToken === "string") providers.add("github");
	if (typeof tokens.cloudflareToken === "string") providers.add("cloudflare");
	return { decisions, reAuthenticate: [...providers].sort() };
}

/** PURE. What happens to one inventory entry in an export. */
export function planEntry(entry: InventoryEntry): ExportPlanEntry {
	const base = path.basename(entry.file);
	const common = { file: entry.file, bytes: entry.bytes };

	if (base === "identity.json" && path.basename(path.dirname(entry.file)) === ".silo") {
		return {
			...common,
			disposition: "re-authenticate",
			reason:
				"a credential file. Its DECISIONS are carried separately in the manifest; its secrets " +
				"are not carried at all, so the bundle stays safe to move.",
		};
	}
	if (entry.recoverability === "recoverable") {
		return { ...common, disposition: "skip", reason: `rebuilt from ${entry.source}` };
	}
	if (entry.recoverability === "unknown") {
		return {
			...common,
			disposition: "undecidable",
			reason: `${entry.reason} — not carried and not dismissed; decide before trusting this backup`,
		};
	}
	if (!entry.declared) {
		return {
			...common,
			disposition: "undecidable",
			reason: `${entry.reason} — carrying every undeclared file would bury the ones that matter`,
		};
	}
	return { ...common, disposition: "carry", reason: entry.reason };
}

/** PURE. The whole plan, counted so a reader can see the shape before opening the list. */
export function planSovereignExport(entries: readonly InventoryEntry[]) {
	const planned = entries.map(planEntry);
	const of = (disposition: ExportDisposition) => planned.filter((e) => e.disposition === disposition);
	return {
		entries: planned,
		carry: of("carry"),
		reAuthenticate: of("re-authenticate"),
		skip: of("skip"),
		undecidable: of("undecidable"),
		carriedBytes: of("carry").reduce((total, entry) => total + (entry.bytes ?? 0), 0),
		/** True when SOMETHING could not be decided — the signal that this backup is not yet complete. */
		hasUndecided: of("undecidable").length > 0,
	};
}

/** PURE. The command that re-obtains one provider's credential. Credential providers have their own
 *  flags; model providers go through `--model-provider`. */
export function reAuthenticateCommand(provider: string): string {
	if (provider === "github") return "refarm sow --github";
	if (provider === "cloudflare") return "refarm sow --cloudflare";
	return `refarm sow --model-provider ${provider}`;
}

/** PURE. The report. Leads with what the bundle will NOT contain, because that is what an operator
 *  discovers too late. */
export function formatExportPlan(
	plan: ReturnType<typeof planSovereignExport>,
	reAuthenticate: readonly string[],
): string {
	const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;
	const lines = ["Sovereign export plan", ""];
	lines.push(`  carries      ${plan.carry.length} file(s), ${kb(plan.carriedBytes)}`);
	for (const entry of plan.carry) lines.push(`    ${entry.file}`);
	lines.push("");
	lines.push("  DOES NOT CARRY SECRETS. Re-authenticate after restoring:");
	if (reAuthenticate.length === 0) lines.push("    (no stored credentials found)");
	for (const provider of reAuthenticate) {
		// THE TWO AXES AGAIN. `github` and `cloudflare` are CREDENTIAL providers and have their own
		// flags; everything else here is a MODEL provider. Printing `--model-provider github` would
		// hand the operator a command that fails, from the very module that split the axes.
		lines.push(`    ${provider}   →  ${reAuthenticateCommand(provider)}`);
	}
	lines.push("");
	lines.push(`  skips        ${plan.skip.length} file(s) that rebuild themselves`);
	if (plan.hasUndecided) {
		lines.push("");
		lines.push(`  UNDECIDED    ${plan.undecidable.length} file(s) — this backup is NOT yet complete.`);
		lines.push("  Each is either unclassified or undeclared. Carrying them all would bury the files");
		lines.push("  that stand the node up; dropping them all could discard data. `--json` lists each");
		lines.push("  with its reason.");
	}
	return lines.join("\n");
}
