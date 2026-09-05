import { CertificateRefusal } from "@refarm.dev/certificate-contract-v1";

/**
 * The X.509 extension blocks, as TEXT. PURE, and deterministic given the same inputs — which is
 * what makes "the name constraint is present and correct" a unit test over a string rather than a
 * claim about a certificate somebody generated once.
 *
 * ── WHY ONE OPERATOR CA, AND WHAT BOUNDS IT ──────────────────────────────────────
 *
 * One CA for all of an operator's nodes, not one per machine. A per-machine CA means every new
 * node must be installed on every device — N×M trust operations that grow forever, and every one
 * of them a manual step in a phone's settings. One CA is installed once per device, and a new node
 * simply gets a certificate from it.
 *
 * That concentrates risk, and the concentration is bounded by four things, of which this file
 * carries one:
 *
 *  1. **`nameConstraints`** — even a compromised CA can only vouch for names under the operator's
 *     own suffix. Written here, critical, as RFC 5280 requires.
 *  2. short-lived leaves, so a leaked leaf expires on its own (the contract enforces it);
 *  3. the CA private key never leaves the node that holds it, mode 0600;
 *  4. rotation as a first-class operation rather than an emergency improvisation.
 *
 * ── THE HONEST CAVEAT ABOUT `nameConstraints` ────────────────────────────────────
 *
 * **Platform enforcement varies, and this is a real reduction rather than a guarantee.** Firefox
 * and OpenSSL evaluate name constraints on user-installed roots. Some platforms — notably several
 * mobile trust stores — do not evaluate them for locally-installed CAs at all, so a CA that this
 * extension says may only sign `*.example.ts.net` could still be honoured for any name there. The
 * constraint is worth writing because it holds where it is enforced and costs nothing where it is
 * not; it is NOT worth relying on as the only bound, which is why the other three exist and why
 * refarm ALSO refuses out-of-suffix names at issuance time ({@link assertNamesUnderSuffixes}) —
 * an enforcement that runs on this machine and does not depend on any device's trust store.
 */

/** Where a Linux distribution keeps operator-installed trust anchors. */
export const LINUX_CA_ANCHOR_DIR = "/usr/local/share/ca-certificates";

/** The command that makes a Linux trust store notice a new anchor. */
export const LINUX_CA_REFRESH_COMMAND = "sudo update-ca-certificates";

/**
 * Normalise DNS suffixes: lowercase, no trailing dot, no leading dot, no empties, deduplicated,
 * sorted. Sorted because the extension text must be deterministic — the same suffixes in a
 * different order must produce a byte-identical constraint, or a "did the CA change?" comparison
 * becomes a coin toss. PURE.
 */
export function normalizeNameSuffixes(suffixes: readonly string[]): string[] {
	const seen = new Set<string>();
	for (const raw of suffixes) {
		const value = raw.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
		if (value) seen.add(value);
	}
	return [...seen].sort();
}

/** Does `name` fall under one of the suffixes, by RFC 5280's DNS rule — the suffix itself, or any
 *  number of labels added on the left? PURE. */
export function nameIsUnderSuffixes(name: string, suffixes: readonly string[]): boolean {
	const candidate = name.trim().toLowerCase().replace(/\.+$/, "");
	if (!candidate) return false;
	return normalizeNameSuffixes(suffixes).some(
		(suffix) => candidate === suffix || candidate.endsWith(`.${suffix}`),
	);
}

/**
 * refarm's OWN enforcement of the constraint, which runs here and depends on no device's trust
 * store. This is the half of the bound that is a guarantee — the extension is the half that is
 * merely a real reduction.
 */
export function assertNamesUnderSuffixes(
	names: readonly string[],
	suffixes: readonly string[],
): string[] {
	const normalized = normalizeNameSuffixes(suffixes);
	if (normalized.length === 0) {
		throw new CertificateRefusal(
			"name-refused",
			"local-ca: the CA has no name suffixes, so it may vouch for nothing at all",
			"Give the CA at least one suffix it owns — its own hostname is enough " +
				'(e.g. nameSuffixes: ["my-node"]).',
		);
	}
	const outside = names.filter((name) => !nameIsUnderSuffixes(name, normalized));
	if (outside.length > 0) {
		throw new CertificateRefusal(
			"name-refused",
			`local-ca: ${outside.map((n) => JSON.stringify(n)).join(", ")} ` +
				`${outside.length === 1 ? "is" : "are"} outside this CA's name constraint ` +
				`(${normalized.join(", ")}) — it will not sign for a name it does not own`,
			`Ask for a name under ${normalized.join(" or ")}, or create a CA for the suffix you mean. ` +
				"This refusal runs here, on this machine: it holds even on a device whose trust store " +
				"ignores the certificate's own nameConstraints extension.",
		);
	}
	return names.map((name) => name.trim().toLowerCase().replace(/\.+$/, ""));
}

/**
 * The CA's extension block.
 *
 * `pathlen:0` so this CA can sign leaves and never a sub-CA — one more thing a compromised key
 * cannot do. `nameConstraints` is `critical`, which is what RFC 5280 §4.2.1.10 requires: a relying
 * party that does not understand the extension must reject the chain rather than quietly ignore
 * the bound. PURE.
 */
export function caExtensions(nameSuffixes: readonly string[]): string {
	const suffixes = normalizeNameSuffixes(nameSuffixes);
	if (suffixes.length === 0) {
		throw new CertificateRefusal(
			"name-refused",
			"local-ca: a CA with no name constraint would be a CA that can vouch for anything",
			'Give at least one suffix — the node\'s own hostname is enough (e.g. ["my-node"]).',
		);
	}
	const permitted = suffixes.map((suffix) => `permitted;DNS:${suffix}`);
	// RFC 5280: a name TYPE absent from permittedSubtrees is unconstrained for that type. DNS is
	// permitted narrowly above; IP is excluded outright here, because a certificate for a bare
	// address is exactly the thing a hostname constraint cannot bound. Other types (email, URI,
	// directoryName) are not expressible as a blanket exclusion in openssl's config syntax; they
	// are covered instead by `assertNamesUnderSuffixes`, which refuses anything that is not a DNS
	// name under the suffixes before openssl is ever called.
	const excluded = ["excluded;IP:0.0.0.0/0.0.0.0", "excluded;IP:::/::"];
	return [
		"basicConstraints = critical,CA:TRUE,pathlen:0",
		"keyUsage = critical,keyCertSign,cRLSign",
		"subjectKeyIdentifier = hash",
		`nameConstraints = critical,${[...permitted, ...excluded].join(",")}`,
	].join("\n");
}

/** The leaf's extension block — a server certificate and nothing else. PURE. */
export function leafExtensions(names: readonly string[]): string {
	if (names.length === 0) {
		throw new CertificateRefusal(
			"name-refused",
			"local-ca: a leaf certificate with no name vouches for nothing",
			"Pass at least one DNS name.",
		);
	}
	return [
		"basicConstraints = critical,CA:FALSE",
		"keyUsage = critical,digitalSignature,keyEncipherment",
		"extendedKeyUsage = serverAuth",
		"subjectKeyIdentifier = hash",
		"authorityKeyIdentifier = keyid,issuer",
		`subjectAltName = ${names.map((name) => `DNS:${name}`).join(",")}`,
	].join("\n");
}

/** The whole openssl config file for the CA. PURE and deterministic. */
export function caConfigFile(nameSuffixes: readonly string[]): string {
	return `[req]\ndistinguished_name = dn\nprompt = no\nx509_extensions = v3_ca\n\n[dn]\n\n[v3_ca]\n${caExtensions(nameSuffixes)}\n`;
}

/** The whole openssl config file for a leaf. PURE and deterministic. */
export function leafConfigFile(names: readonly string[]): string {
	return `[req]\ndistinguished_name = dn\nprompt = no\n\n[dn]\n\n[v3_leaf]\n${leafExtensions(names)}\n`;
}

/** A filesystem-safe stem for a certificate's files, derived from its first name. PURE. */
export function certificateFileStem(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "leaf";
}
