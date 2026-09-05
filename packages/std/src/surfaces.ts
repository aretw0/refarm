/**
 * Declared surfaces — the TypeScript half of ONE vocabulary
 * (docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md, O4/O5).
 *
 * The Rust twin is `packages/tractor/src/host/host_effects_bridge/surfaces_decl.rs`, and this
 * file is a deliberate MIRROR of it: same surface names, same `expose`/`gate` values, same
 * parse-time refusals, same wording where the wording is a contract. O4 exists because a
 * `.refarm/config.json` must mean ONE thing — before the Rust half widened `KNOWN_SURFACES`,
 * declaring a TS-owned surface did not merely go unread, it made the daemon refuse to boot.
 * If one side changes, the other must change with it.
 *
 * WHAT THIS REPLACES. `refuseUnguardedNonLoopbackBind` (bind-guard.ts) asks "is a policy file
 * present somewhere on this machine?" — a question no TS surface's own gate is the answer to.
 * A Node listener could bind off-loopback because some OTHER surface had credentials, while
 * declaring nothing and verifying nothing. O5 replaces that criterion with the rule the Rust
 * guard already follows:
 *
 * - **S1 — undeclared means loopback.** Silence is closed, and it is the ABSENCE of a value,
 *   not a default a flag can overwrite.
 * - **S5 — the declaration is the ceiling; a flag may only narrow it.** A `--host` value may
 *   match the declared address or fall inside it (loopback is inside every ceiling), never
 *   point somewhere else or wider.
 * - **S3 — a surface may not declare a gate it cannot enforce.** Checked HERE, AT PARSE, for
 *   every declared surface, exactly as the Rust parser checks it.
 *
 * PURE — no I/O, no `fs`, no env, no DNS. The caller supplies the parsed config object; it
 * MUST have read it from the FILESYSTEM `.refarm/config.json` and never from the replicated
 * config node, because exposure decides how THIS machine is reachable and a declaration
 * replicated from another device must never decide it (`surfaces_decl.rs` states the same
 * doctrine; `resolve_connections` established it).
 */

import { bindHostsMatch, isLoopbackBindHost } from "./bind-guard.js";

/** The Rust daemon's two surfaces: it binds and enforces these. Named here because O4 says
 *  ONE vocabulary — the TS parser validates their shape too, so a config the daemon accepts
 *  is a config this parser accepts, and vice versa. */
export const SURFACE_SIDECAR_HTTP = "sidecar-http";
export const SURFACE_DAEMON_WS = "daemon-ws";
/** `serveCapabilities`, the SDK primitive from the 07-29 design's example block. */
export const SURFACE_CAPABILITIES = "capabilities";
/**
 * The `refarm web serve` LISTENER — named for the listener, never for its payload.
 *
 * The 07-30 design's prose calls the bootstrap surface `dist-http`, after what it serves.
 * That is the SAME listener, and O6 is why only ONE of the two names may exist: `web serve`
 * carries the dist artifacts AND proxies to `127.0.0.1:42000`/`42001`, so declaring it open
 * opens all of them — "this cannot be waved off as 'a different surface'". A name taken from
 * the payload invites exactly that excuse, and admitting both names would let one listener
 * carry two `expose`/`gate` values with no answer as to which wins. `dist-http` stays refused
 * as an unknown name, here as in Rust.
 */
export const SURFACE_WEB = "web";

export const KNOWN_SURFACES: readonly string[] = [
	SURFACE_SIDECAR_HTTP,
	SURFACE_DAEMON_WS,
	SURFACE_CAPABILITIES,
	SURFACE_WEB,
];

const MAX_SURFACES = 8;

/**
 * A gate a surface may declare. The wire spellings are `"device-token"` and `"none"`; `"none"`
 * parses to `"open"` here for the same reason Rust spells it `SurfaceGate::Open` — at a
 * comparison site whose whole point is telling a DECLARATION from SILENCE, a value spelled
 * `"none"` sitting beside a `null` is a misreading waiting to happen.
 *
 * The `SurfaceGate | null` this sits inside carries the distinction O1 is about:
 * - `null` — no `gate` key. SILENCE, indistinguishable from an oversight, never permission.
 * - `"open"` — the operator wrote `"gate": "none"`. A DECLARATION, reviewable as one. NOT a
 *   gate: it satisfies nothing that wants one.
 * - `"device-token"` — the bearer credential the Rust sidecar middleware and ADR-093's WS
 *   handshake actually verify.
 */
export type SurfaceGate = "device-token" | "open";

/** `expose` intent (S2: "expose is intent, not an address"). `host` is SHAPE-validated only —
 *  stored as declared, never resolved, never trusted. `tailnet` carries no address at all: it
 *  is resolved at BIND time by asking Tailscale, never here. */
export type SurfaceExpose =
	| { readonly kind: "loopback" }
	| { readonly kind: "host"; readonly host: string }
	| { readonly kind: "tailnet" };

/** One surface's parsed, validated declaration. */
export interface SurfaceDeclaration {
	readonly expose: SurfaceExpose;
	readonly gate: SurfaceGate | null;
}

/** The parsed `surfaces` block, keyed by surface name. An empty catalog is S1's silence. */
export type SurfaceCatalog = ReadonlyMap<string, SurfaceDeclaration>;

/**
 * What `surface` can ACTUALLY enforce today, independent of anything declared for it — the S3
 * capability table, kept identical to `surfaces_decl::surface_enforceable_gate`. `null` means
 * no enforcement mechanism exists at all, so no gate value can ever make a non-loopback
 * `expose` legal for that surface.
 *
 * `web` and `capabilities` are `null` and that is the whole point of this slice: `refarm web
 * serve` never reads `Authorization` — not once — so it cannot honestly declare `device-token`
 * at any `expose`, loopback included.
 */
export function surfaceEnforceableGate(surface: string): SurfaceGate | null {
	switch (surface) {
		case SURFACE_SIDECAR_HTTP:
			return "device-token";
		// ADR-093's `Sec-WebSocket-Protocol` credential handshake gives `daemon-ws` the same
		// enforcement `sidecar-http` has.
		case SURFACE_DAEMON_WS:
			return "device-token";
		default:
			return null;
	}
}

/** Thrown when a `surfaces` block is present but does not parse, or declares a combination S3
 *  or O2 refuses. Fail-shut, like `parse_surfaces`: a refused declaration is not a warning. */
export class SurfaceDeclarationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SurfaceDeclarationError";
	}
}

function parseGate(raw: string, surface: string): SurfaceGate {
	if (raw === "device-token") return "device-token";
	// O1: deliberate openness is a VALUE, not an omission. Whether it is ADMISSIBLE here is a
	// question about the COMBINATION it appears in — answered by `validateDeclaredCombination`.
	if (raw === "none") return "open";
	throw new SurfaceDeclarationError(
		`surfaces['${surface}'].gate ${JSON.stringify(raw)} is not a known gate — a surface may ` +
			'declare "device-token" (a bearer credential is verified on every request) or "none" ' +
			'(deliberately open, admissible only with "expose": "tailnet")',
	);
}

/** Parse `expose`'s STRING form into intent (S2). PURE — `host:<ip>` is only SHAPE-validated
 *  (a parseable IP literal), never resolved or trusted. */
function parseExpose(raw: string, surface: string): SurfaceExpose {
	if (raw === "loopback") return { kind: "loopback" };
	if (raw === "tailnet") return { kind: "tailnet" };
	if (!raw.startsWith("host:")) {
		throw new SurfaceDeclarationError(
			`surfaces['${surface}'].expose ${JSON.stringify(raw)} is not a known value — expected ` +
				'"loopback", "host:<ip>", or "tailnet"',
		);
	}
	const ipRaw = raw.slice("host:".length);
	if (!isIpLiteral(ipRaw)) {
		throw new SurfaceDeclarationError(
			`surfaces['${surface}'].expose "host:${ipRaw}" is not a valid, fully-specified IP ` +
				'address literal — "host:<ip>" takes a concrete address, never a hostname (nothing ' +
				"here resolves DNS)",
		);
	}
	return { kind: "host", host: ipRaw };
}

/** `true` when `raw` (optionally bracketed) is an IP literal this substrate will reason about.
 *  Shape only — `bindHostsMatch` is the one place two such literals are ever compared. */
function isIpLiteral(raw: string): boolean {
	return bindHostsMatch(raw, raw);
}

/** `true` when a declared `host:<ip>` names EVERY interface (`0.0.0.0`, `[::]`). Used ONLY to
 *  sharpen a refusal's wording; the refusal itself does not depend on it. */
function declaredHostIsUnspecified(raw: string): boolean {
	const unbracketed = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
	if (/^0+(\.0+){3}$/.test(unbracketed)) return true;
	return /^0*(:0*)*::(0*:)*0*$/.test(unbracketed) && !unbracketed.includes(".");
}

/**
 * The whole S3 + O2 rule set over an already-shape-valid `(expose, gate)` pair, checked AT
 * PARSE (never deferred to bind time). PURE. Kept in lockstep with
 * `surfaces_decl::validate_declared_combination` — four rules, same order:
 *
 * 1. **O1/S3** — a surface may not declare a gate it cannot enforce, at ANY `expose`,
 *    loopback included. Claiming an enforcement that does not exist is a lie wherever it
 *    binds, and `"gate": "none"` exists precisely so the honest thing is sayable.
 * 2. **O2** — `"gate": "none"` is admissible only over an admitted-device transport.
 * 3. **O2** — a surface that HAS a real gate may not declare itself open beyond loopback.
 * 4. **S3** — a non-loopback `expose` needs a gate this surface can actually enforce.
 */
function validateDeclaredCombination(
	name: string,
	expose: SurfaceExpose,
	exposeRaw: string,
	gate: SurfaceGate | null,
): void {
	const enforceable = surfaceEnforceableGate(name);

	// (1) O1/S3 — the declared gate must be one THIS surface actually verifies.
	if (gate === "device-token" && enforceable !== "device-token") {
		throw new SurfaceDeclarationError(
			`surfaces['${name}'].gate "device-token": '${name}' verifies no bearer credential at ` +
				"all, so declaring that gate would claim an enforcement that does not exist. If " +
				`'${name}' is deliberately open, say so — declare "gate": "none", which is ` +
				'admissible with "expose": "tailnet" or "loopback"',
		);
	}

	// (2)/(3) O2 — the combination rules that make deliberate openness safe rather than merely
	// documented.
	if (gate === "open") {
		// Loopback + "none" is admissible and means NOTHING special: loopback was already the
		// floor S1 gives every surface. It still says the openness is a choice.
		if (expose.kind === "loopback") return;
		if (expose.kind === "tailnet") {
			if (enforceable !== null) {
				throw new SurfaceDeclarationError(
					`surfaces['${name}'] declares "gate": "none" with "expose": "tailnet", but ` +
						`'${name}' accepts mutations and HAS a credential gate — deliberate openness is ` +
						"admissible only for a read-only surface that grants nothing. Declare " +
						`"gate": "device-token" to expose '${name}' on the tailnet`,
				);
			}
			return;
		}
		if (declaredHostIsUnspecified(expose.host)) {
			throw new SurfaceDeclarationError(
				`surfaces['${name}'] declares "gate": "none" with "expose": "host:${expose.host}" — ` +
					"that is EVERY interface on this machine, the one exposure deliberate openness may " +
					'never combine with. Declare "expose": "tailnet" instead: an open surface is ' +
					"admissible only because arriving over an admitted-device transport is itself the " +
					`first factor, and ${expose.host} admits nobody in particular`,
			);
		}
		throw new SurfaceDeclarationError(
			`surfaces['${name}'] declares "gate": "none" with "expose": "host:${expose.host}" — ` +
				"deliberate openness is admissible only over a transport whose peers the operator " +
				"already admitted, and a literal address is not evidence of one: nothing here " +
				"resolves or trusts it (S2), including an address that merely LOOKS like a tailnet's " +
				"100.64.0.0/10 (that range is RFC 6598 carrier-grade NAT, which Tailscale borrows and " +
				`ISPs and containers also use). Declare "expose": "tailnet" to open '${name}' to ` +
				'admitted devices, or narrow it to "loopback"',
		);
	}

	// (4) S3, unchanged: a non-loopback `expose` must name a gate this surface can actually
	// enforce — never a gate it lacks the machinery for, and never NO gate at all.
	if (expose.kind === "loopback") return;
	if (enforceable === null) {
		throw new SurfaceDeclarationError(
			`surfaces['${name}'].expose = ${JSON.stringify(exposeRaw)}: '${name}' has no credential ` +
				'gate implemented at all — it may declare "loopback", or "tailnet" together with ' +
				'"gate": "none" if it is deliberately open (read-only, admitted devices only)',
		);
	}
	if (gate === null) {
		throw new SurfaceDeclarationError(
			`surfaces['${name}'].expose = ${JSON.stringify(exposeRaw)} needs a gate — declare ` +
				`"gate": "device-token" to bind '${name}' beyond loopback`,
		);
	}
	if (gate !== enforceable) {
		throw new SurfaceDeclarationError(
			`surfaces['${name}'].gate does not name a gate '${name}' can enforce`,
		);
	}
}

function parseOneSurface(name: string, value: unknown): SurfaceDeclaration {
	if (!KNOWN_SURFACES.includes(name)) {
		throw new SurfaceDeclarationError(
			`surfaces['${name}'] is not a surface any refarm runtime declares — the vocabulary is ` +
				`"${SURFACE_SIDECAR_HTTP}" and "${SURFACE_DAEMON_WS}" (the refarm daemon binds and ` +
				`enforces these), plus "${SURFACE_CAPABILITIES}" and "${SURFACE_WEB}" (the ` +
				"TypeScript runtime binds these)",
		);
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new SurfaceDeclarationError(
			`surfaces['${name}'] must be an object, e.g. { "expose": "loopback" }`,
		);
	}
	const obj = value as Record<string, unknown>;

	const exposeRaw = obj.expose;
	if (typeof exposeRaw !== "string") {
		throw new SurfaceDeclarationError(
			`surfaces['${name}'].expose is required and must be a string`,
		);
	}
	const expose = parseExpose(exposeRaw, name);

	let gate: SurfaceGate | null = null;
	if (obj.gate !== undefined && obj.gate !== null) {
		if (typeof obj.gate !== "string") {
			throw new SurfaceDeclarationError(`surfaces['${name}'].gate must be a string`);
		}
		gate = parseGate(obj.gate, name);
	}

	validateDeclaredCombination(name, expose, exposeRaw, gate);
	return { expose, gate };
}

/**
 * Parse the `surfaces` block of an already-read config object. An absent block is an empty
 * catalog — S1's silence, every surface binds loopback; a present-but-malformed block THROWS,
 * exactly like `parse_surfaces`. PURE.
 */
export function parseSurfaces(config: unknown): SurfaceCatalog {
	if (config === null || typeof config !== "object" || Array.isArray(config)) {
		return new Map();
	}
	const block = (config as Record<string, unknown>).surfaces;
	if (block === undefined || block === null) return new Map();
	if (typeof block !== "object" || Array.isArray(block)) {
		throw new SurfaceDeclarationError("surfaces must be an object");
	}
	const entries = Object.entries(block as Record<string, unknown>);
	if (entries.length > MAX_SURFACES) {
		throw new SurfaceDeclarationError(`too many surfaces declared (max ${MAX_SURFACES})`);
	}
	const out = new Map<string, SurfaceDeclaration>();
	for (const [name, value] of entries) out.set(name, parseOneSurface(name, value));
	return out;
}

/**
 * The host an absent flag resolves to — mirrors `bind_guard::resolve_declared_bind_host`.
 *
 * An absent flag resolves to whatever `host:<ip>` the declaration names; loopback when the
 * declaration says `loopback`, is absent entirely (S1), or is still an unresolved `tailnet`.
 * That last case is a fail-CLOSED fallback, not an expected path: the caller resolves
 * `tailnet` to a concrete address BEFORE calling this, or refuses.
 *
 * `flag` being `undefined` is load-bearing and is why `web serve`'s `--host` may not carry a
 * commander default. Under a narrowing rule a CLI default stops being neutral: a flag that
 * ALWAYS carries `127.0.0.1` ALWAYS narrows, so a declaration could never take effect and
 * nothing would say so. `undefined` means "the operator did not pass `--host`; let the
 * declaration decide". PURE.
 */
export function resolveDeclaredBindHost(
	flag: string | undefined,
	declared: SurfaceDeclaration | undefined,
): string {
	if (flag !== undefined) return flag;
	if (declared?.expose.kind === "host") return declared.expose.host;
	return "127.0.0.1";
}

/**
 * Refuse a bind the `surfaces` declaration does not permit. Returns `null` when the bind is
 * allowed, or the refusal message when it is not. PURE — no socket, no I/O, no env, no DNS.
 *
 * This is O5's replacement for `refuseUnguardedNonLoopbackBind`'s criterion, and it is a
 * question about THIS surface rather than about the machine: a policy file existing somewhere
 * can no more permit this bind than a neighbour's lock can secure this door.
 *
 * - loopback ⇒ always allowed, declared or not. It is inside every ceiling.
 * - non-loopback + no declaration ⇒ refused (S1).
 * - non-loopback + `expose: "loopback"` ⇒ refused (S5) — the flag is widening past the ceiling.
 * - non-loopback + `host:<ip>` that does not match ⇒ refused (S5) — the declaration is
 *   authoritative for WHICH address, not merely for whether non-loopback is legal.
 * - non-loopback + an unresolved `tailnet` ⇒ refused — intent is not an address (S2); the
 *   caller must resolve it first, and reaching here means it did not.
 * - matching address + `gate: "none"` ⇒ allowed, and ONLY for a surface with no enforcement of
 *   its own (O2's read-only clause: `surfaceEnforceableGate(surface) === null`).
 * - matching address + `gate: "device-token"` on a surface that cannot enforce it ⇒ refused —
 *   unreachable through `parseSurfaces`, kept as defence in depth for a declaration built some
 *   other way, exactly as the Rust guard keeps its mirror arm.
 * - matching address + no gate ⇒ refused (S3).
 */
export function refuseBindOutsideDeclaration(
	surface: string,
	host: string,
	declared: SurfaceDeclaration | undefined,
	label = `the ${surface} surface`,
): string | null {
	if (isLoopbackBindHost(host)) return null;

	if (!declared) {
		return (
			`refusing to bind ${label} to non-loopback host ${JSON.stringify(host)}: no ` +
			`\`surfaces.${surface}\` declaration is present in .refarm/config.json, and an ` +
			"undeclared surface binds loopback only. Declare it first:\n" +
			`  "surfaces": { "${surface}": { "expose": "tailnet", "gate": "none" } }\n` +
			'"gate": "none" says the surface is DELIBERATELY open — admissible only over the ' +
			"tailnet, read-only, and granting nothing."
		);
	}

	if (declared.expose.kind === "loopback") {
		return (
			`refusing to bind ${label} to non-loopback host ${JSON.stringify(host)}: ` +
			`surfaces.${surface} declares "expose": "loopback" — a flag may narrow that ` +
			"declaration, never widen it. Widen the declaration in .refarm/config.json first."
		);
	}

	if (declared.expose.kind === "tailnet") {
		return (
			`refusing to bind ${label} to ${JSON.stringify(host)}: surfaces.${surface} declares ` +
			'"expose": "tailnet", which is INTENT, not an address — it must be resolved against ' +
			"this machine's actual tailnet address before a bind, and it was not."
		);
	}

	const declaredHost = declared.expose.host;
	if (!bindHostsMatch(host, declaredHost)) {
		return (
			`refusing to bind ${label} to ${JSON.stringify(host)}: surfaces.${surface} declares ` +
			`"expose": "host:${declaredHost}" — a flag may only match that declaration or narrow ` +
			"it to loopback, never point somewhere else or wider."
		);
	}

	const enforceable = surfaceEnforceableGate(surface);
	switch (declared.gate) {
		case "open":
			if (enforceable !== null) {
				return (
					`refusing to bind ${label} to ${JSON.stringify(host)}: surfaces.${surface} ` +
					'declares "gate": "none", but this surface accepts mutations and HAS a credential ' +
					"gate — deliberate openness is admissible only for a read-only surface that grants " +
					'nothing. Declare "gate": "device-token" instead.'
				);
			}
			return null;
		case "device-token":
			// Refused only where the SURFACE cannot enforce it — which is what the arm always
			// meant and, until this was noticed, not what it did: it refused unconditionally,
			// so a declaration `sidecar-http`/`daemon-ws` really can enforce was refused too.
			// That went unseen because no TypeScript listener bound either surface. Whether the
			// listener at hand can enforce it is a SEPARATE question, and a stricter one — see
			// `refuseGateThisListenerCannotEnforce`, which farmhand's Node CRDT relay needs
			// precisely because `daemon-ws` CAN enforce and that relay cannot.
			//
			// The Rust twin takes one more input this has no way to ask for: whether a policy is
			// actually RESOLVABLE right now (`auth_policy_resolvable`). A TypeScript listener
			// that genuinely verifies bearers must check that itself before binding; none does
			// today, which is exactly why `surfaceEnforceableGate` answers `null` for both
			// TS-owned surfaces.
			if (enforceable !== "device-token") {
				return (
					`refusing to bind ${label} to ${JSON.stringify(host)}: surfaces.${surface} declares ` +
					`"gate": "device-token", but '${surface}' verifies no bearer credential at all, so ` +
					'nothing would enforce it. Declare "gate": "none" if it is deliberately open.'
				);
			}
			return null;
		default:
			return (
				`refusing to bind ${label} to ${JSON.stringify(host)}: surfaces.${surface} declares a ` +
				'non-loopback expose with no gate. Declare "gate": "none" to say it is deliberately ' +
				"open (read-only, admitted devices only), or narrow the expose to loopback."
			);
	}
}

/**
 * Refuse a bind whose DECLARED gate THIS listener does not itself verify.
 *
 * {@link refuseBindOutsideDeclaration} asks whether the VOCABULARY permits the bind, and its
 * capability table ({@link surfaceEnforceableGate}) answers per SURFACE — which is the same thing
 * only while exactly one listener binds each name. It is not. `daemon-ws` is bound by the Rust
 * daemon, whose ADR-093 `Sec-WebSocket-Protocol` handshake really does verify a bearer, AND by
 * farmhand's Node CRDT relay, which verifies nothing at all (`ws_server.rs` opens with "WebSocket
 * daemon — replaces farmhand on port 42000"). For that relay the table is true of the surface and
 * false of the listener, and S3 — "a surface may not declare a gate it cannot enforce" — is a
 * statement about whatever is actually accepting the connection.
 *
 * So a listener passes what IT verifies and this refuses the mismatch. Two clauses, and the second
 * is the one that keeps a declaration from going silently inert:
 *
 * - a NON-LOOPBACK declaration whose gate this listener does not verify is refused — binding it
 *   would be the appearance of a gate without a gate;
 * - refused EVEN WHEN the resolved host came out loopback. An unresolved `tailnet` resolves to
 *   loopback through {@link resolveDeclaredBindHost}'s fail-closed fallback, so without this the
 *   listener would quietly bind loopback under a tailnet declaration and say nothing — exactly the
 *   defaulted-flag failure mode, one layer down. The operator asked for something this listener
 *   cannot do; it has to hear that.
 *
 * An operator who passes an explicit LOOPBACK host has narrowed the bind themselves (S5) and is
 * exposing nothing, so there is no unenforceable claim left to refuse — that is the one case this
 * lets through.
 *
 * `gate: "open"` never trips this: openness is the explicit statement that nothing is verified
 * (O1), not a claim of enforcement. PURE.
 */
export function refuseGateThisListenerCannotEnforce(
	surface: string,
	declared: SurfaceDeclaration | undefined,
	verifies: SurfaceGate | null,
	flagHost: string | undefined,
	label = `the ${surface} surface`,
): string | null {
	// S1 — no declaration is not a claim. `refuseBindOutsideDeclaration` refuses the bind itself.
	if (!declared) return null;
	if (declared.expose.kind === "loopback") return null;
	// No gate at all is S3's other failure, and the shared guard already refuses it.
	if (declared.gate === null) return null;
	// O1 — "deliberately open" claims no enforcement, so there is nothing to fail to enforce.
	if (declared.gate === "open") return null;
	if (declared.gate === verifies) return null;
	// The operator narrowed to loopback themselves: nothing is exposed, so nothing is claimed.
	if (flagHost !== undefined && isLoopbackBindHost(flagHost)) return null;

	return (
		`refusing to bind ${label}: surfaces.${surface} declares "gate": ` +
		`${JSON.stringify(declared.gate)}, and this listener verifies ` +
		(verifies === null ? "no credential at all" : `only ${JSON.stringify(verifies)}`) +
		`. The declaration may be honoured by another runtime that binds '${surface}' — the ` +
		"capability table is per SURFACE — but it cannot be honoured HERE, and binding beyond " +
		"loopback anyway would be the appearance of a gate without a gate (S3). Narrow this " +
		"listener with an explicit loopback host, or run the runtime that enforces the gate."
	);
}

/** The host a listener will bind, and the declaration that decided it. */
export interface SurfaceBindResolution {
	/** The host `listen()` will actually be given. */
	readonly host: string;
	/** The declaration that decided it — `undefined` when the surface is undeclared (S1), and
	 *  carrying the RESOLVED address when `expose: "tailnet"` was resolved. */
	readonly declared: SurfaceDeclaration | undefined;
}

export interface ResolveDeclaredSurfaceBindInput {
	/** Which declared surface this listener IS — one of {@link KNOWN_SURFACES}. */
	readonly surface: string;
	readonly surfaces: SurfaceCatalog;
	/** The `--host`/env value the operator actually passed, or `undefined` when they passed none.
	 *  `undefined` is LOAD-BEARING — see {@link resolveDeclaredBindHost}'s note on defaulted flags. */
	readonly flagHost?: string | undefined;
	/** How the listener is named in a refusal, so an operator learns WHICH one refused. */
	readonly label?: string;
	/** What THIS listener actually verifies, when that differs from the surface's own capability
	 *  table — see {@link refuseGateThisListenerCannotEnforce}. Defaults to the table. */
	readonly verifies?: SurfaceGate | null;
	/** Seam for `expose: "tailnet"` (S2: intent, never an address at parse time). Absent means this
	 *  listener has no way to ask, and a tailnet declaration it would have to resolve is refused
	 *  rather than quietly narrowed. */
	readonly resolveTailnet?: () => TailnetSelfResolution;
}

/** What asking the tailnet for THIS machine's address produced. `ok` carries the IPv4; the two
 *  failure shapes are kept apart because they are different operator actions — "the tailnet is
 *  down" is `tailscale up`, "I could not ask" is a broken/missing CLI. */
export type TailnetSelfResolution =
	| { readonly ok: true; readonly ipv4: string }
	| { readonly ok: false; readonly reason: "down" | "unreachable"; readonly detail: string };

/**
 * THE bind rule for a declared surface, in one place — O5, whole.
 *
 * Every TypeScript listener that owns a surface calls this and binds what it returns, or does not
 * bind at all. It exists so the ORDER of the four questions is written once: getting them in the
 * wrong order is how a listener ends up refusing with the wrong reason, or silently narrowing where
 * it should refuse.
 *
 * 1. **Can this listener enforce what was declared?** ({@link refuseGateThisListenerCannotEnforce})
 *    FIRST, because it is the only question that does not depend on resolving anything — and
 *    because asking it later would answer a `tailnet` declaration with "intent is not an address"
 *    when the true reason is that this listener could never have honoured it.
 * 2. **What address is `tailnet`, concretely?** Resolved HERE, at bind time, never at parse (S2).
 *    Skipped when a loopback flag has already settled the question.
 * 3. **What host does an absent flag mean?** ({@link resolveDeclaredBindHost}) — the declaration's,
 *    or loopback.
 * 4. **Does the declaration permit THIS bind?** ({@link refuseBindOutsideDeclaration}) — S1/S3/S5.
 *
 * Throws the refusal rather than returning it: there is nothing sensible to return when a bind is
 * refused, and every call site is a `listen()`. PURE except for the injected `resolveTailnet`.
 */
export function resolveDeclaredSurfaceBind(
	input: ResolveDeclaredSurfaceBindInput,
): SurfaceBindResolution {
	const { surface, surfaces, flagHost, resolveTailnet } = input;
	const label = input.label ?? `the ${surface} surface`;
	const verifies = input.verifies === undefined ? surfaceEnforceableGate(surface) : input.verifies;
	const declared = surfaces.get(surface);

	const unenforceable = refuseGateThisListenerCannotEnforce(
		surface,
		declared,
		verifies,
		flagHost,
		label,
	);
	if (unenforceable) throw new Error(unenforceable);

	// A loopback flag needs no tailnet at all: it narrows every ceiling, so resolving would be work
	// done to answer a question already settled.
	const wantsTailnet =
		declared?.expose.kind === "tailnet" &&
		(flagHost === undefined || !isLoopbackBindHost(flagHost));

	let effective = declared;
	if (wantsTailnet) {
		if (!resolveTailnet) {
			throw new Error(
				`refusing to bind ${label}: surfaces.${surface} declares "expose": "tailnet", and this ` +
					"listener has no way to resolve that against this machine's tailnet address. A " +
					"declared tailnet expose FAILS CLOSED — it is never quietly narrowed to loopback. " +
					"Narrow it explicitly with a loopback host, or bind it from a listener that resolves " +
					"the tailnet.",
			);
		}
		const resolution = resolveTailnet();
		if (!resolution.ok) {
			throw new Error(
				`refusing to bind ${label}: surfaces.${surface} declares "expose": "tailnet" and ` +
					`${resolution.detail}. ` +
					(resolution.reason === "down"
						? "Bring the tailnet up (`tailscale up`) or narrow the bind with `--host 127.0.0.1`."
						: "Install/repair the `tailscale` CLI, or narrow the bind with `--host 127.0.0.1`.") +
					" A declared tailnet expose FAILS CLOSED when the tailnet cannot answer — it never" +
					" falls back to a wider address.",
			);
		}
		effective = { expose: { kind: "host", host: resolution.ipv4 }, gate: declared?.gate ?? null };
	}

	const host = resolveDeclaredBindHost(flagHost, effective);
	const refusal = refuseBindOutsideDeclaration(surface, host, effective, label);
	if (refusal) throw new Error(refusal);

	return { host, declared: effective };
}

/**
 * `true` when ANY declared surface names `"gate": "device-token"` — the node-wide fact that a
 * credential policy is part of what this node declared, mirroring
 * `surfaces_decl::any_surface_declares_device_token_gate`.
 *
 * Node-WIDE, not per-surface, because the policy is node-wide: ONE `auth-policy.json`, read by
 * the sidecar's HTTP middleware and by ADR-093's WS handshake alike. `"gate": "none"` answers
 * NO here, deliberately (O1) — declaring deliberate openness is the opposite of declaring a
 * credential gate and must never derive a policy path.
 *
 * This does NOT widen any surface. Its only consumer is O6's question about the surfaces a
 * proxy forwards TO — never a question about the surface doing the forwarding.
 */
export function anySurfaceDeclaresDeviceTokenGate(surfaces: SurfaceCatalog): boolean {
	for (const decl of surfaces.values()) if (decl.gate === "device-token") return true;
	return false;
}
