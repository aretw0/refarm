/**
 * certificate:v1 — a surface's TLS certificate is DECLARED, and provisioning is a registry.
 *
 * T2 of `docs/superpowers/specs/2026-07-31-sovereign-tls-design.md`. The same seam as discovery
 * sources, admitted-device transports and delivery adapters: a provider is one file plus one
 * registry line, and the CANONICAL one depends on nothing outside the machine.
 *
 * THE THIRD CASE IS THE ONE THAT PROVES THE SEAM. An operator who ALREADY has a certificate — from
 * their own infrastructure, from a corporate CA, from anywhere — declares its path and uses no
 * provider at all. That is why {@link CertificateDeclaration} is a union whose first arm calls
 * nothing: if the only way to get a certificate were to generate one, this would be a generator
 * with a plug-in point, not a declaration. `resolveCertificate` never touches the registry for a
 * `declared` certificate — proven by a test that resolves one against an EMPTY registry.
 *
 * WHAT THIS BLOCK REFUSES TO BE:
 *
 *  - It does not issue anything. Node cannot mint X.509 (`node:crypto`'s `X509Certificate` PARSES,
 *    it does not sign), so issuance needs an external tool and belongs in a provider that can say
 *    honestly which tool it needs and what to do when it is absent.
 *  - It does not read files by itself. The `exists` seam is injected, so a test needs no real
 *    filesystem and this block needs no opinion about where an operator keeps their keys.
 *  - It never carries key MATERIAL. {@link CertificateMaterial} holds PATHS. A private key that is
 *    never in a value is a private key that cannot be logged, serialised into a JSON envelope, or
 *    attached to an error — the same posture the Telegram token and the auth policy already have.
 *
 * WHY THE LEAF LIFETIME IS THE CONTRACT'S BUSINESS AND NOT EACH PROVIDER'S. One operator CA
 * vouching for every node concentrates risk; the design accepts that concentration and bounds it,
 * and a short leaf is one of the four bounds. A bound each provider re-decides is a bound that one
 * provider quietly drops, so {@link assertShortLeafLifetime} lives HERE and every provider is
 * measured by it.
 *
 * Zero runtime dependencies, `node:` built-ins only — so the node and the zero-dependency device
 * kit can consume the same block.
 */

export const CERTIFICATE_CAPABILITY = "certificate:v1" as const;

/** The stable context IRI for certificate declarations (parallels operation-consent/records). */
export const CERTIFICATE_CONTEXT_IRI = "https://refarm.dev/contexts/certificate/v1" as const;

// ── The lifetime policy ───────────────────────────────────────────────────────

/**
 * How long a leaf certificate may live, in days.
 *
 * SHORT ON PURPOSE. A leaked leaf that expires on its own is a leak with a deadline; a leaf good
 * for a year is a standing credential nobody remembers issuing. 30 days is the default because it
 * is short enough to bound the damage and long enough that renewal is a supervised process rather
 * than a thing the operator does by hand every week.
 */
export const DEFAULT_LEAF_LIFETIME_DAYS = 30;

/** The hard ceiling. A provider asking for more is refused, not warned. */
export const MAX_LEAF_LIFETIME_DAYS = 90;

/**
 * How long the operator's CA lives. Long, deliberately: a CA that expires is a CA that must be
 * re-installed on EVERY device, which is the N×M trust operation one-CA-per-operator exists to
 * avoid. The bound on a CA is its name constraint and the fact that its key never moves, not its
 * clock.
 */
export const DEFAULT_CA_LIFETIME_DAYS = 3650;

/** When a leaf is considered due for rotation — renewal is a first-class operation, not an
 *  emergency. Two thirds through its life leaves a full third of runway to notice and act. */
export const LEAF_ROTATION_MARGIN_RATIO = 1 / 3;

// ── Refusals ──────────────────────────────────────────────────────────────────

/**
 * Every refusal in this domain, with the FIX in the value rather than in a sentence a caller has
 * to compose. A missing tool, an unknown provider and a declared-but-absent file are all things an
 * operator can act on, and an error that says only "failed" makes them go looking.
 *
 * `message` carries ONLY what went wrong; `fix` carries ONLY what to do about it — the same split
 * every sibling refusal in this repo keeps (`SupervisionRefusal`, `DeliveryDeclarationError`: both
 * call `super(message)` and leave `fix` as its own field). Baking `fix` into `message` too, as this
 * constructor once did, does not add information — `error.fix` already carries it — and it made a
 * refusal printed by `refarm cert` show its own guidance TWICE: once from `message` (which had the
 * fix appended) and once more from the caller printing `error.fix` beside it, the way every other
 * refusal in this codebase is rendered.
 */
export class CertificateRefusal extends Error {
	/** What the operator does about it. Always present, always actionable. */
	readonly fix: string;
	/** A stable tag a caller can branch on without matching prose. */
	readonly reason: CertificateRefusalReason;

	constructor(reason: CertificateRefusalReason, message: string, fix: string) {
		super(message);
		this.name = "CertificateRefusal";
		this.reason = reason;
		this.fix = fix;
	}
}

export type CertificateRefusalReason =
	/** The declaration itself does not parse or is internally contradictory. */
	| "malformed-declaration"
	/** A provider was named that the registry does not hold. */
	| "unknown-provider"
	/** A declared certificate names a file that is not there. */
	| "missing-file"
	/** The provider needs an external tool that this machine does not have. */
	| "tool-missing"
	/** A lifetime outside what the contract permits. */
	| "lifetime-refused"
	/** A name the provider is not permitted to vouch for. */
	| "name-refused"
	/** The tool ran and failed. */
	| "issuance-failed";

/**
 * The leaf-lifetime bound, enforced. Returns the value so it reads as a coercion at a call site.
 * PURE.
 */
export function assertShortLeafLifetime(days: number): number {
	if (!Number.isInteger(days) || days < 1) {
		throw new CertificateRefusal(
			"lifetime-refused",
			`certificate: a leaf lifetime of ${JSON.stringify(days)} is not a whole number of days ≥ 1`,
			`Ask for between 1 and ${MAX_LEAF_LIFETIME_DAYS} days (default ${DEFAULT_LEAF_LIFETIME_DAYS}).`,
		);
	}
	if (days > MAX_LEAF_LIFETIME_DAYS) {
		throw new CertificateRefusal(
			"lifetime-refused",
			`certificate: a leaf lifetime of ${days} days exceeds the ${MAX_LEAF_LIFETIME_DAYS}-day ` +
				"ceiling — a long-lived leaf is a standing credential, and a leaked one would outlive " +
				"anyone's memory of issuing it",
			// The point is IDEMPOTENCE, not which command does it — and this is a pure validator
			// with no caller context to thread a binary through (ADR-087, ISS-114).
			`Ask for at most ${MAX_LEAF_LIFETIME_DAYS} days, and let rotation renew it ` +
				"(re-issuing is idempotent by design).",
		);
	}
	return days;
}

// ── What a certificate IS, once resolved ──────────────────────────────────────

/**
 * A usable certificate, as PATHS. Never PEM, and above all never key material: this value is
 * returned from commands that print JSON, and a private key that is never in a value is a private
 * key no envelope can leak.
 */
export interface CertificateMaterial {
	/** Absolute path to the leaf certificate (PEM). Safe to print. */
	certFile: string;
	/** Absolute path to the private key (PEM), mode 0600. Safe to PRINT — never to READ into an
	 *  envelope, a log line, or an error. */
	keyFile: string;
	/** Absolute path to the issuing CA certificate, when there is one to trust. `null` for a
	 *  publicly-trusted certificate (`tailscale cert`) and for a declared pair whose chain the
	 *  operator manages themselves. */
	caFile: string | null;
	/** The DNS names this certificate vouches for. */
	names: string[];
	/** ISO-8601. `null` when nothing parsed it (a declared pair resolved without inspection). */
	notBefore: string | null;
	/** ISO-8601. `null` for the same reason. */
	notAfter: string | null;
	/** Which provider produced it, or `null` when the operator declared an existing pair — the
	 *  distinction is exactly T2's third case, and it survives into the resolved value. */
	providerId: string | null;
}

/** Is this certificate due for rotation at `now`? PURE — no ambient clock. Unknown validity reads
 *  as "cannot tell", which is `false`: refusing to serve on a guess is worse than serving. */
export function needsRotation(material: CertificateMaterial, now: Date): boolean {
	if (!material.notBefore || !material.notAfter) return false;
	const start = Date.parse(material.notBefore);
	const end = Date.parse(material.notAfter);
	if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false;
	return now.getTime() >= end - (end - start) * LEAF_ROTATION_MARGIN_RATIO;
}

// ── The declaration ───────────────────────────────────────────────────────────

/**
 * How a surface says where its certificate comes from.
 *
 * `declared` names files and consults NOTHING. `provider` names a registry entry and the names to
 * vouch for. There is no third arm and no implicit default: silence means no TLS, which is the
 * same S1 doctrine `surfaces` already follows — an absent declaration is closed, never a guess.
 */
export type CertificateDeclaration =
	| {
			readonly kind: "declared";
			readonly certFile: string;
			readonly keyFile: string;
			/** The CA to hand to a client that must trust it, when the operator has one. */
			readonly caFile?: string;
	  }
	| {
			readonly kind: "provider";
			readonly provider: string;
			readonly names: readonly string[];
			/** Days. Absent ⇒ {@link DEFAULT_LEAF_LIFETIME_DAYS}. */
			readonly lifetimeDays?: number;
	  };

/**
 * Parse a `certificate` block from already-parsed JSON. Fail-shut, like `parse_surfaces`: a
 * declaration that does not parse is a refusal, never a warning and never a fallback to "no TLS" —
 * an operator who wrote the block meant it, and silently ignoring it is how a surface ends up
 * serving plaintext while its config says otherwise. PURE.
 */
export function parseCertificateDeclaration(
	raw: unknown,
	where = "certificate",
): CertificateDeclaration {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new CertificateRefusal(
			"malformed-declaration",
			`${where} must be an object`,
			'Write either {"certFile": "...", "keyFile": "..."} for a certificate you already have, ' +
				'or {"provider": "local-ca", "names": ["<host>"]} to have refarm issue one.',
		);
	}
	const record = raw as Record<string, unknown>;
	const hasFiles = "certFile" in record || "keyFile" in record;
	const hasProvider = "provider" in record;
	if (hasFiles && hasProvider) {
		throw new CertificateRefusal(
			"malformed-declaration",
			`${where} names BOTH a provider and a certificate file — only one of them can be the ` +
				"source, and which one wins is not something this block will guess",
			"Keep `provider` to have refarm issue the certificate, or keep `certFile`/`keyFile` to " +
				"use the one you already have. Not both.",
		);
	}
	if (hasFiles) {
		const certFile = record["certFile"];
		const keyFile = record["keyFile"];
		if (typeof certFile !== "string" || !certFile || typeof keyFile !== "string" || !keyFile) {
			throw new CertificateRefusal(
				"malformed-declaration",
				`${where} declares a certificate file pair, but certFile/keyFile are not both non-empty strings`,
				"A certificate is a PAIR: give both `certFile` and `keyFile`.",
			);
		}
		const caFile = record["caFile"];
		if (caFile !== undefined && (typeof caFile !== "string" || !caFile)) {
			throw new CertificateRefusal(
				"malformed-declaration",
				`${where}.caFile must be a non-empty string when present`,
				"Drop `caFile` if the chain is publicly trusted; otherwise point it at the issuing CA PEM.",
			);
		}
		return {
			kind: "declared",
			certFile,
			keyFile,
			...(typeof caFile === "string" ? { caFile } : {}),
		};
	}
	const provider = record["provider"];
	if (typeof provider !== "string" || !provider) {
		throw new CertificateRefusal(
			"malformed-declaration",
			`${where} declares neither a provider nor a certFile/keyFile pair`,
			'Add {"provider": "local-ca", "names": ["<host>"]}, or point at files you already have.',
		);
	}
	const names = record["names"];
	if (
		!Array.isArray(names) ||
		names.length === 0 ||
		names.some((n) => typeof n !== "string" || !n)
	) {
		throw new CertificateRefusal(
			"malformed-declaration",
			`${where}.names must be a non-empty array of non-empty DNS names — a provider cannot ` +
				"issue a certificate without knowing what it is for",
			'Add e.g. "names": ["my-node", "my-node.tailnet.ts.net"].',
		);
	}
	const lifetimeDays = record["lifetimeDays"];
	if (lifetimeDays !== undefined && typeof lifetimeDays !== "number") {
		throw new CertificateRefusal(
			"malformed-declaration",
			`${where}.lifetimeDays must be a number of days when present`,
			`Drop it to take the ${DEFAULT_LEAF_LIFETIME_DAYS}-day default.`,
		);
	}
	if (typeof lifetimeDays === "number") assertShortLeafLifetime(lifetimeDays);
	return {
		kind: "provider",
		provider,
		names: names as string[],
		...(typeof lifetimeDays === "number" ? { lifetimeDays } : {}),
	};
}

// ── The provider seam ─────────────────────────────────────────────────────────

/** What a provider is asked for. */
export interface CertificateIssueRequest {
	/** The DNS names the certificate must vouch for. */
	names: readonly string[];
	/** Days the leaf may live. Already bounded by {@link assertShortLeafLifetime}. */
	lifetimeDays: number;
}

/**
 * One way of obtaining a certificate. `local-ca` is the canonical one; `tailscale-cert` is the
 * second, and exists to prove this interface rather than to shape it.
 *
 * `preflight` is separate from `issue` on purpose: "can this machine do it at all?" is a question
 * worth answering BEFORE anything is written, and it is the question an honest refusal for a
 * missing tool comes out of. A provider whose tool is absent must REFUSE, naming the fix — never
 * crash with whatever `spawn` threw.
 */
export interface CertificateProvider {
	/** The registry id an operator writes in a declaration. */
	readonly id: string;
	/** One line describing what this provider does. */
	readonly title: string;
	/** What it needs from the machine or the network, in the operator's terms. */
	readonly requires: readonly string[];
	/** What the operator pays for choosing it — device friction, external exposure. Stated so the
	 *  choice is made knowingly (T3's table, carried into the code). */
	readonly costs: readonly string[];
	/** Can this machine use it right now? Never throws — the refusal is the RESULT. */
	preflight(): Promise<CertificateProviderReadiness>;
	/** Issue (or renew) a certificate. Throws {@link CertificateRefusal}. */
	issue(request: CertificateIssueRequest): Promise<CertificateMaterial>;
}

export type CertificateProviderReadiness =
	| { ready: true; detail: string }
	| { ready: false; reason: CertificateRefusalReason; detail: string; fix: string };

/** The registry. One line per provider, exactly as T2 asks. */
export interface CertificateProviderRegistry {
	register(provider: CertificateProvider): void;
	get(id: string): CertificateProvider | null;
	ids(): string[];
	list(): CertificateProvider[];
}

export function createCertificateProviderRegistry(
	seed: readonly CertificateProvider[] = [],
): CertificateProviderRegistry {
	const providers = new Map<string, CertificateProvider>();
	const registry: CertificateProviderRegistry = {
		register(provider) {
			if (providers.has(provider.id)) {
				throw new CertificateRefusal(
					"malformed-declaration",
					`certificate: provider "${provider.id}" is already registered`,
					"Two providers may not share an id — an operator writing that id must get one answer.",
				);
			}
			providers.set(provider.id, provider);
		},
		get(id) {
			return providers.get(id) ?? null;
		},
		ids() {
			return [...providers.keys()].sort();
		},
		list() {
			return registry.ids().map((id) => providers.get(id) as CertificateProvider);
		},
	};
	for (const provider of seed) registry.register(provider);
	return registry;
}

// ── Resolution ────────────────────────────────────────────────────────────────

/** The only I/O resolution performs, injected so a test needs no filesystem. */
export interface CertificateFileProbe {
	/** Does this path exist as a readable file? */
	(path: string): Promise<boolean>;
}

/**
 * Turn a declaration into usable material.
 *
 * THE ORDER IS THE POINT. A `declared` certificate is resolved WITHOUT the registry — no provider
 * is looked up, none is required to exist, and an empty registry resolves it fine. That is T2's
 * third case, and it is what makes this seam about DECLARATION rather than generation.
 */
export async function resolveCertificate(options: {
	declaration: CertificateDeclaration;
	registry?: CertificateProviderRegistry;
	exists: CertificateFileProbe;
}): Promise<CertificateMaterial> {
	const { declaration, exists } = options;

	if (declaration.kind === "declared") {
		for (const [label, file] of [
			["certFile", declaration.certFile],
			["keyFile", declaration.keyFile],
			...(declaration.caFile ? ([["caFile", declaration.caFile]] as const) : []),
		] as ReadonlyArray<readonly [string, string]>) {
			if (!(await exists(file))) {
				throw new CertificateRefusal(
					"missing-file",
					`certificate: the declared ${label} "${file}" is not there`,
					"Point the declaration at the file you actually have, or drop it and declare a " +
						'provider instead ({"provider": "local-ca", "names": ["<host>"]}).',
				);
			}
		}
		return {
			certFile: declaration.certFile,
			keyFile: declaration.keyFile,
			caFile: declaration.caFile ?? null,
			names: [],
			notBefore: null,
			notAfter: null,
			providerId: null,
		};
	}

	const registry = options.registry;
	const provider = registry?.get(declaration.provider) ?? null;
	if (!provider) {
		const known = registry?.ids() ?? [];
		throw new CertificateRefusal(
			"unknown-provider",
			`certificate: no provider is registered under "${declaration.provider}"`,
			known.length > 0
				? `Registered providers: ${known.join(", ")}. Or declare a certificate you already ` +
						"have with `certFile`/`keyFile` and use no provider at all."
				: "No providers are registered at all. Declare a certificate you already have with " +
						"`certFile`/`keyFile`.",
		);
	}
	const readiness = await provider.preflight();
	if (!readiness.ready) {
		throw new CertificateRefusal(readiness.reason, readiness.detail, readiness.fix);
	}
	return provider.issue({
		names: declaration.names,
		lifetimeDays: assertShortLeafLifetime(declaration.lifetimeDays ?? DEFAULT_LEAF_LIFETIME_DAYS),
	});
}
