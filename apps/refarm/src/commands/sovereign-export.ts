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

export type ExportDisposition =
	| "carry"
	| "re-authenticate"
	| "skip"
	| "undecidable"
	/**
	 * REAL FILES THIS NODE DOES NOT CLAIM. Not carried, not deleted, and not a loose end.
	 *
	 * The operator's policy, chosen 2026-08-13: a storage namespace the node does not declare is not
	 * the node's data. This is DECIDED, which is what separates it from `undecidable` — and the
	 * separation is the point, because a backup with 71 permanent "undecided" entries would report
	 * itself incomplete forever and the warning would stop meaning anything.
	 *
	 * It is a policy rather than a cleanup: the 65 scratch databases on his node are retired by it,
	 * and so are the ones written next week.
	 */
	| "foreign"
	/**
	 * IRRECOVERABLE **AND** SECRET, and no login rebuilds it.
	 *
	 * Found on the operator's node 2026-08-12: `~/.refarm/tls/ca.key` is the private key of his own
	 * local certificate authority. Regenerating it is not recovery — every device that trusted the
	 * old CA stops trusting the node until it is re-enrolled by hand. Beside it sit the node's TLS
	 * key and `~/.refarm/delivery/telegram.token`.
	 *
	 * Neither of the two easy answers is right. Dropping them silently loses something no login can
	 * return; carrying them silently turns the bundle into a credential the operator may sync to a
	 * phone or a cloud drive believing it safe. So they are their own disposition: excluded by
	 * default, named in the plan, and carried only when the operator says so — at which point the
	 * bundle must be stored like a password, and the command says that out loud.
	 *
	 * Until this existed these files were skipped only because NO RULE CLASSIFIED THEM. Safe by
	 * accident is the shape this repository keeps removing.
	 */
	| "sensitive";

export interface ExportPlanEntry {
	readonly file: string;
	readonly disposition: ExportDisposition;
	readonly reason: string;
	/** Bytes, when the inventory measured them. `null` stays null — never rounded to 0. */
	readonly bytes: number | null;
	/** How an excluded secret comes back. Present only on `sensitive` — absent everywhere else,
	 *  because a concept that does not apply must not answer. */
	readonly recovery?: SecretRecovery;
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

/**
 * Directories and suffixes inside the node home whose contents are SECRET.
 *
 * By location rather than by filename, because a list of filenames is what let `tls/` and
 * `delivery/telegram.token` fall through in the first place. A new key dropped into `tls/` is
 * covered the day it appears; a new secret directory is not, which is why unregistered paths stay
 * `undecidable` and visible instead of defaulting to carried.
 */
const SENSITIVE_DIRECTORIES = ["tls", "delivery"];
const SENSITIVE_SUFFIXES = [".key", ".token", ".pem"];

/** PURE. Is this entry a secret that lives outside the silo? */
export function isSensitivePath(file: string): boolean {
	const segments = file.split(/[/\\]/u);
	const base = segments.at(-1) ?? "";
	if (SENSITIVE_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true;
	// A directory match alone is not enough — `tls/ca.crt` is a public certificate and `ca.cnf` is
	// a config. Only the material that must not travel is named.
	return SENSITIVE_DIRECTORIES.includes(segments.at(-2) ?? "") && /\.(key|token|pem|p12|pfx)$/u.test(base);
}

/**
 * HOW AN EXCLUDED SECRET COMES BACK — the third state, and it exists because two were not enough.
 *
 * `sensitive` says a file does not travel. It never said what to DO about that, and the first real
 * `refarm backup create` on the operator's node (2026-08-16) showed the cost: the bundle verified
 * intact, excluded three secrets correctly, and named none of them anywhere a reader would look.
 * `reAuthenticate` listed providers and matched no excluded path, so the manifest read as the whole
 * answer while being silent about the three files that decide whether a restored node can serve.
 *
 * One verb could not cover them, because they are not the same kind of loss:
 *
 * - `re-obtain`    an external issuer mints a new one and nothing else is affected.
 * - `re-issue`     this node makes a new one from material it still holds.
 * - `re-establish` NOTHING brings the value back, and the replacement invalidates trust that
 *                  other parties already granted. This is the state that had no name, and
 *                  flattening it into `re-issue` would promise a local fix for something that
 *                  reaches every browser the operator taught to trust this node.
 */
export type SecretRecovery = "re-obtain" | "re-issue" | "re-establish";

/** PURE. How an excluded secret comes back, or `null` when the file is not a secret at all. */
export function secretRecovery(file: string): SecretRecovery | null {
	if (!isSensitivePath(file)) return null;
	const base = path.basename(file);
	// The CA is the node's own trust anchor. `refarm cert issue` can build one, but a NEW CA is a
	// different anchor: `refarm cert trust` has to run again wherever the old one was accepted.
	if (base === "ca.key") return "re-establish";
	// Everything else under `tls/` is a leaf this node signs with the CA it still has.
	if (base.endsWith(".key") || base.endsWith(".pem")) return "re-issue";
	return "re-obtain";
}

const RECOVERY_REASON: Record<SecretRecovery, string> = {
	"re-obtain":
		"ask the service that issued it for a new one — nothing else on this node is affected.",
	"re-issue": "re-issue it with `refarm cert issue`, using the CA this node still holds.",
	"re-establish":
		"NOTHING brings this value back. `refarm cert issue` builds a NEW certificate authority, " +
		"which means every device that trusted this node's CA must trust again (`refarm cert trust`). " +
		"Carry it with --include-secrets, or accept re-establishing trust everywhere.",
};

/** PURE. What happens to one inventory entry in an export. */
export function planEntry(entry: InventoryEntry): ExportPlanEntry {
	const base = path.basename(entry.file);
	const common = { file: entry.file, bytes: entry.bytes };

	const recovery = secretRecovery(entry.file);
	if (recovery) {
		return {
			...common,
			disposition: "sensitive",
			// ON THE ENTRY, never in a list beside it. ISS-113 and ISS-124 are both one defect —
			// a second copy of the truth that drifts from the first — and a recovery map keyed by
			// path somewhere else would have been the third.
			recovery,
			reason:
				"a secret that no login rebuilds. Excluded by default: a bundle containing it must be " +
				`stored like a password. To recover it, ${RECOVERY_REASON[recovery]}`,
		};
	}

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
			disposition: "foreign",
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
		sensitive: of("sensitive"),
		foreign: of("foreign"),
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
	if (plan.sensitive.length > 0) {
		lines.push("");
		lines.push(`  SECRETS      ${plan.sensitive.length} file(s) no login rebuilds — NOT carried by default:`);
		// PER FILE, mirroring the `provider  →  command` shape above. A bare path under a paragraph
		// that says "a local CA key, for instance" leaves the reader to work out which of their
		// files that sentence is about — and ISS-127 is precisely that the three differ in what
		// recovery MEANS. `re-establish` is the one worth reading twice.
		for (const entry of plan.sensitive) {
			lines.push(`    ${entry.file}   →  ${entry.recovery ?? "unclassified"}`);
		}
		lines.push("  Losing these is not recoverable by logging in again; a local CA key, for instance,");
		lines.push("  means every device that trusted this node must be re-enrolled. Carrying them makes");
		lines.push("  the bundle a credential. `--include-secrets` carries them, and then the bundle must");
		lines.push("  be stored like a password.");
	}
	lines.push("");
	lines.push(`  skips        ${plan.skip.length} file(s) that rebuild themselves`);
	if (plan.foreign.length > 0) {
		lines.push(
			`  foreign      ${plan.foreign.length} file(s) this node does not claim — not carried, not deleted`,
		);
	}
	if (plan.hasUndecided) {
		lines.push("");
		lines.push(`  UNDECIDED    ${plan.undecidable.length} file(s) — this backup is NOT yet complete.`);
		lines.push("  Each is either unclassified or undeclared. Carrying them all would bury the files");
		lines.push("  that stand the node up; dropping them all could discard data. `--json` lists each");
		lines.push("  with its reason.");
	}
	return lines.join("\n");
}
