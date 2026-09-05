/**
 * THE DECLARED LAYOUT OF A NODE'S HOME — what lives where, and what each thing IS.
 *
 * ## Why a registry replaced a list of filename rules
 *
 * The first inventory classified by filename, one `if` per case. That is a list, and lists rot in
 * the direction that hurts: on 2026-08-13 it had already missed `~/.refarm/tls/ca.key` — the
 * operator's own certificate authority private key — which was excluded from backups only because
 * NO RULE MATCHED IT. Safe by accident. The next plausible rule ("carry what is unclassified")
 * would have leaked it.
 *
 * So the question moved. Not "what is this file called" but "what does this node DECLARE about the
 * directory it sits in". Declared over detected, which is this repository's rule everywhere else.
 *
 * ## Natures, and why `foreign` earns its place
 *
 * `decision`  — the operator's choices. No login and no rebuild returns them.
 * `data`      — accumulated work and identity. Same: irreplaceable, and not secret.
 * `secret`    — material that must not travel by default. Excluded unless asked for, always named.
 * `cache`     — rebuilt or refetched. Skipped, with the source that rebuilds it.
 * `foreign`   — real files this node does not claim. NOT carried and NOT deleted.
 *
 * `foreign` is the operator's own policy, chosen 2026-08-13: a storage namespace the node does not
 * declare is not the node's data. His `~/.local/share/refarm` held 67 databases of which 2 carry
 * his declared namespace; the other 65 are scratch and test leftovers. A list would have retired
 * those 65 and grown again next week. A rule retires the ones after them too.
 *
 * ## Unregistered is its own answer
 *
 * A path no entry covers is `unregistered` — not `cache`, not `foreign`. It means a subsystem
 * writes somewhere this file does not know about, which is exactly how a CA key went unnoticed.
 * It is reported, it fails the layout gate, and the fix is to add the entry deliberately.
 */

export type SovereignNature = "decision" | "data" | "secret" | "cache" | "foreign" | "unregistered";

export interface LayoutVerdict {
	readonly nature: SovereignNature;
	readonly reason: string;
	/** For `cache`, what brings it back. Absent for every other nature. */
	readonly rebuiltBy?: string;
}

interface LayoutRule {
	/** Matched against the path relative to the node home, with `/` separators. */
	readonly match: (relative: string, declaredNamespaces: readonly string[]) => boolean;
	readonly verdict: (relative: string) => LayoutVerdict;
}

/** `<dir>/` prefix test that will not match `.refarmX/`. */
const under = (prefix: string) => (relative: string) => relative.startsWith(`${prefix}/`);
const is = (name: string) => (relative: string) => relative === name;
const endsWithAny = (suffixes: string[]) => (relative: string) =>
	suffixes.some((suffix) => relative.endsWith(suffix));

/** A storage file's namespace: `.refarm/data/refarm/default.db` → `default`. */
export function namespaceOf(relative: string): string | null {
	const match = /(?:^|\/)([^/]+)\.(?:db|peer)$/u.exec(relative);
	return match?.[1] ?? null;
}

const STORAGE_DIRECTORIES = [".refarm/data/refarm", ".local/share/refarm"];

/**
 * The layout, in order. First match wins, so the specific precedes the general — a `.key` inside
 * `tls/` must be read as a secret before `tls/` is read as identity material.
 */
export const SOVEREIGN_LAYOUT: LayoutRule[] = [
	{
		// SECRETS FIRST, ALWAYS. Anything that can be read as a secret is, before any broader rule
		// gets a chance to call it ordinary.
		match: (relative) =>
			endsWithAny([".key", ".token", ".pem", ".p12", ".pfx"])(relative) ||
			relative === ".silo/identity.json",
		verdict: (relative) => ({
			nature: "secret",
			reason:
				relative.endsWith("ca.key")
					? "the private key of THIS NODE'S certificate authority. Regenerating it is not recovery: every device that trusted the old one must be re-enrolled by hand."
					: relative === ".silo/identity.json"
						? "the credential store. Its decisions are lifted into the manifest; its secrets never travel."
						: "key or token material — it must not travel unless asked for",
		}),
	},
	{
		match: (relative, declared) => {
			const namespace = namespaceOf(relative);
			return (
				namespace !== null &&
				STORAGE_DIRECTORIES.some((dir) => relative.startsWith(`${dir}/`)) &&
				declared.includes(namespace)
			);
		},
		verdict: (relative) => ({
			nature: "data",
			reason: `storage for the declared namespace "${namespaceOf(relative)}" — the node's accumulated work`,
		}),
	},
	{
		// THE OPERATOR'S POLICY, 2026-08-13. Undeclared is not disposable and not carried: this file
		// cannot prove a scratch database is scratch, and deleting on a guess is how an inventory
		// loses the thing it protects.
		match: (relative, declared) => {
			const namespace = namespaceOf(relative);
			return (
				namespace !== null &&
				STORAGE_DIRECTORIES.some((dir) => relative.startsWith(`${dir}/`)) &&
				!declared.includes(namespace)
			);
		},
		verdict: (relative) => ({
			nature: "foreign",
			reason: `namespace "${namespaceOf(relative)}" is not declared by this node — not carried, and not deleted either`,
		}),
	},
	{
		match: (relative) => /^\.refarm\/config\.json\.bak/u.test(relative),
		verdict: () => ({
			nature: "foreign",
			reason: "a backup made by hand — the node never declared it, and it is the only copy of whatever it holds",
		}),
	},
	{
		match: is(".refarm/config.json"),
		verdict: () => ({
			nature: "decision",
			reason: "the operator's declarations — workspaces, connections, processes, declared base",
		}),
	},
	{
		match: is(".refarm/auth-policy.json"),
		verdict: () => ({ nature: "decision", reason: "who may reach this node, and how" }),
	},
	{
		// THE MODEL-ACCOUNT CATALOG. Descriptors only — provider, the operator's alias, health, and a
		// secretRef that is a LOCATION and never material. It is a decision rather than data because
		// the aliases are his and, more importantly, `modelBindings` in the config points at these
		// credentialIds: losing this file orphans every binding while the secrets survive, which is a
		// node that looks configured and cannot choose an account.
		match: is(".refarm/model-accounts.json"),
		verdict: () => ({
			nature: "decision",
			reason: "which model accounts this node holds, and the aliases the operator gave them",
		}),
	},
	{
		match: (relative) => is(".refarm/node-id")(relative) || is(".refarm/node.json")(relative),
		verdict: () => ({
			nature: "data",
			reason: "this node's identity — a new one is a different node to every peer that trusted it",
		}),
	},
	{
		match: under(".refarm/tls"),
		verdict: () => ({
			nature: "data",
			reason: "certificate authority material other than its key — needed to restore the node's identity",
		}),
	},
	{
		match: (relative) =>
			under(".refarm/sas")(relative) ||
			under(".refarm/task-results")(relative) ||
			is(".refarm/task-memory.db")(relative) ||
			// The FILENAME, wherever a block writes it. Measured 2026-08-19: declaring the first
			// supervised process created `.refarm/processes/operations.json` and sent the whole
			// backup plan back to `hasUndecided`. A rule naming one path leaves the next block's
			// trail undecidable — the same reason the lock rule keys on a suffix.
			(relative.startsWith(".refarm/") && relative.endsWith("/operations.json")) ||
			is(".refarm/operations.json")(relative),
		verdict: () => ({ nature: "data", reason: "the node's own record of what it has done" }),
	},
	{
		match: (relative) =>
			relative.endsWith("-audit.ndjson") || relative === ".refarm/streams/activity.ndjson",
		verdict: () => ({
			nature: "data",
			reason: "an audit trail — append-only, and nothing rebuilds a record of the past",
		}),
	},
	{
		// ISS-123's last undecidable entry on the operator's node: `.refarm/session.lock`.
		//
		// A lock names a LIVE process. Carried into a bundle and restored elsewhere it points at a
		// pid that does not exist there, and a STALE lock is worse than an absent one — it can make
		// the restored node refuse to start, or believe a session is already held. Keyed on the
		// suffix rather than on the filename, because a rule that named `session.lock` would leave
		// the next lock undecidable, which is exactly how this entry came to exist.
		match: endsWithAny([".lock"]),
		verdict: () => ({
			nature: "cache",
			reason: "a lock held by a running process — it describes a moment, not the node",
			rebuiltBy: "the process that takes it, on the next run",
		}),
	},
	{
		match: (relative) => under(".refarm/dist")(relative) || under(".refarm/plugins")(relative),
		verdict: () => ({
			nature: "cache",
			reason: "installed or downloaded artifacts",
			rebuiltBy: "refarm plugin install / refarm dist",
		}),
	},
	{
		match: under(".refarm/assets"),
		verdict: () => ({
			nature: "cache",
			reason: "content-addressed by its own hash, so it is refetchable wherever the source still is",
			rebuiltBy: "re-fetch by digest",
		}),
	},
	{
		match: (relative) =>
			under(".refarm/cache")(relative) ||
			under(".refarm/sessions")(relative) ||
			under(".refarm/streams")(relative) ||
			relative.endsWith(".managed.json") ||
			is(".refarm/model-rates.v1.json")(relative),
		verdict: () => ({
			nature: "cache",
			reason: "working state refarm rewrites on its own",
			rebuiltBy: "the next run",
		}),
	},
];

/**
 * PURE. What the layout says about one path, relative to the node home.
 *
 * `declaredNamespaces` is the node's own storage declaration. It is passed in rather than read so
 * this can be tested against a node that does not exist — and so an EMPTY declaration means
 * exactly that, rather than quietly meaning "everything".
 */
export function classifyByLayout(
	relative: string,
	declaredNamespaces: readonly string[],
): LayoutVerdict {
	const normalised = relative.split(/[\\/]/u).join("/");
	for (const rule of SOVEREIGN_LAYOUT) {
		if (rule.match(normalised, declaredNamespaces)) return rule.verdict(normalised);
	}
	return {
		nature: "unregistered",
		reason:
			"no layout entry covers this path. Something writes here that the layout does not describe — " +
			"which is how a certificate authority key went unnoticed. Add an entry deliberately.",
	};
}

/**
 * The storage namespaces a node declares as its own.
 *
 * THREE STATES, and the middle one is the reason this is a function. A config that DECLARES an
 * empty list is saying "none of them are mine"; a config with no storage block at all has not been
 * asked the question yet, and falling back to the conventional `default` keeps a node that predates
 * this from reporting its own database as foreign. `origin` says which happened, so the report can
 * tell the operator whether he chose this.
 */
export function declaredNamespaces(config: unknown): {
	namespaces: string[];
	origin: "declared" | "convention";
} {
	const storage = (config as { storage?: { namespaces?: unknown } } | null)?.storage;
	if (storage && Array.isArray(storage.namespaces)) {
		return { namespaces: storage.namespaces.filter((n): n is string => typeof n === "string"), origin: "declared" };
	}
	return { namespaces: ["default"], origin: "convention" };
}
