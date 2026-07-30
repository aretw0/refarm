/**
 * Fail-closed bind guard — the TypeScript twin of `packages/tractor/src/sidecar/bind_guard.rs`.
 *
 * A listener's bind host is the difference between "only this machine" and "every device that can
 * route to me". The Rust daemon already refuses to open a non-loopback listener with no auth
 * policy configured; this is the same doctrine for the Node listeners, which carried the same
 * defect in the place where it multiplies — the SDK primitive every consuming app builds on.
 *
 * Two rules, both PURE functions of their arguments — no socket, no DNS, no I/O, no env read — so
 * they are exhaustively unit-tested without ever binding a port:
 *
 *   1. The DEFAULT is loopback. A surface that takes no host must not bind the unspecified
 *      address. (Node's `server.listen(port, cb)` with no host binds every interface; that is the
 *      bug, and a default is the fix that requires no caller to remember anything.)
 *   2. A non-loopback bind with no auth policy configured is REFUSED, not warned about.
 *
 * Deliberately kept identical to the Rust guard, including the subtleties it documents: the
 * unspecified addresses and the WHOLE IPv4-mapped family (`::ffff:*`) are NOT loopback, and an
 * unparseable host fails closed. If one side changes, the other must change with it — the two
 * guards protect the same ports on the same machine and must not disagree about what "loopback"
 * means.
 */

/** IPv4 dotted-quad, exactly 4 octets. Range and leading-zero checks happen in the parser. */
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/**
 * The four IPv4 octets, or `null` when `text` is not a canonical dotted quad. PURE.
 *
 * Leading zeros are rejected (`010.0.0.1`): they are not canonical, and different parsers
 * disagree about whether they are octal — a disagreement between this guard and the OS about
 * which address a string means is exactly the gap a guard must not have.
 */
function parseIpv4(text: string): number[] | null {
	const match = IPV4.exec(text);
	if (!match) return null;
	const octets: number[] = [];
	for (const part of match.slice(1, 5)) {
		if (part.length > 1 && part.startsWith("0")) return null;
		const value = Number(part);
		if (value > 255) return null;
		octets.push(value);
	}
	return octets;
}

/**
 * The eight IPv6 hextets, or `null` when `text` is not an IPv6 literal this guard will reason
 * about. PURE — never resolves anything.
 *
 * An embedded IPv4 part (`::ffff:127.0.0.1`) returns `null` ON PURPOSE, so the whole IPv4-mapped
 * family lands in the "does not parse ⇒ not loopback" branch. This mirrors Rust, where the
 * address parses fine but `Ipv6Addr::is_loopback()` matches ONLY the literal `::1`. Folding a
 * mapped address down to its embedded IPv4 form — the "obvious simplification" — would make
 * `::ffff:127.0.0.1` read as loopback and silently allow an all-interfaces-reachable bind through
 * the back door. See the same warning in `bind_guard.rs`.
 */
function parseIpv6(text: string): number[] | null {
	if (text.includes(".")) return null;
	if (!/^[0-9a-f:]+$/.test(text)) return null;

	const elision = text.indexOf("::");
	let head: string[];
	let tail: string[];
	if (elision === -1) {
		head = text.split(":");
		tail = [];
		if (head.length !== 8) return null;
	} else {
		// Exactly one `::` is legal.
		if (text.indexOf("::", elision + 1) !== -1) return null;
		const headText = text.slice(0, elision);
		const tailText = text.slice(elision + 2);
		head = headText === "" ? [] : headText.split(":");
		tail = tailText === "" ? [] : tailText.split(":");
		if (head.length + tail.length > 7) return null;
	}

	const groups = [...head, ...new Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
	const hextets: number[] = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
		hextets.push(Number.parseInt(group, 16));
	}
	return hextets;
}

/**
 * `true` for `127.0.0.0/8`, `::1`, `[::1]` and the literal `localhost`. Everything else — the
 * unspecified addresses `0.0.0.0` / `::` / `[::]`, the entire IPv4-mapped range `::ffff:*`
 * (INCLUDING `::ffff:127.0.0.1`), and any host that does not parse as an IP — is NOT loopback.
 * PURE.
 *
 * A surrounding `[...]` is stripped first: that is RFC 3986 host syntax and the spelling an
 * operator or a config file actually writes for IPv6. The stripping is SYNTAX ONLY — it removes
 * bracket characters and never touches the address's bits or family.
 */
export function isLoopbackBindHost(host: string): boolean {
	const trimmed = host.trim();
	if (trimmed.toLowerCase() === "localhost") return true;

	const unbracketed =
		trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;

	const v4 = parseIpv4(unbracketed);
	if (v4) {
		// 0.0.0.0 — every interface, the single most dangerous host to get wrong here. Spelled
		// out rather than left to fall through, so the exclusion cannot regress silently.
		if (v4.every((octet) => octet === 0)) return false;
		return v4[0] === 127;
	}

	const v6 = parseIpv6(unbracketed.toLowerCase());
	// Doesn't parse and isn't `localhost` ⇒ unknown shape ⇒ fail closed, not loopback.
	if (!v6) return false;
	// `::` — the unspecified address. Same reasoning as `0.0.0.0` above.
	if (v6.every((hextet) => hextet === 0)) return false;
	return v6.slice(0, 7).every((hextet) => hextet === 0) && v6[7] === 1;
}

/**
 * Do two bind hosts name the SAME address? The TS twin of `bind_guard::hosts_match`, and the
 * one place a requested host is ever compared against a declared `host:<ip>` (see
 * `surfaces.ts`). PURE.
 *
 * Fails CLOSED: if either side does not parse as an IP literal this guard reasons about, the
 * answer is `false` — an unparseable host never "matches" a declaration, so a declaration can
 * never be satisfied by a string neither side agrees about. That is stricter than Rust for the
 * IPv4-mapped family (`::ffff:1.2.3.4` parses in Rust and not here), and stricter is the safe
 * direction: it refuses a bind rather than permitting one.
 */
export function bindHostsMatch(a: string, b: string): boolean {
	const normalizedA = normalizeBindIp(a);
	const normalizedB = normalizeBindIp(b);
	if (normalizedA === null || normalizedB === null) return false;
	return normalizedA === normalizedB;
}

/** A canonical, comparable spelling of an IP literal, or `null` when `host` is not one.
 *  Family-tagged so a v4 and a v6 value can never collide as strings. */
function normalizeBindIp(host: string): string | null {
	const trimmed = host.trim();
	const unbracketed =
		trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
	const v4 = parseIpv4(unbracketed);
	if (v4) return `v4:${v4.join(".")}`;
	const v6 = parseIpv6(unbracketed.toLowerCase());
	if (v6) return `v6:${v6.join(":")}`;
	return null;
}

/** How a listener's bind was decided, for callers that want to log or assert it. */
export interface BindDecision {
	/** The host that will actually be passed to `listen()`. */
	host: string;
	/** Whether that host is loopback-only. */
	loopback: boolean;
}

/**
 * Refuse a non-loopback bind when no auth policy is configured. Returns `null` when the bind is
 * allowed, or the refusal message when it is not. PURE: never binds a socket, never reads env or
 * disk — the caller resolves `authPolicyPresent` (see `authPolicyPresent()` in
 * `@refarm.dev/std/node`, which reads the SAME `REFARM_AUTH_POLICY` file the Rust sidecar reads).
 *
 * SCOPE, since O5 (docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md):
 * this guard answers "has the operator opted into the identity gate on this machine" — a fact
 * about the MACHINE, not about the surface asking. For a surface that VERIFIES bearers that is
 * the right question and this remains the right guard. For one that does not, it never was:
 * a Node listener could bind off-loopback because some OTHER surface had credentials, while
 * declaring nothing and verifying nothing. Such a surface must use
 * `resolveDeclaredSurfaceBind` (surfaces.ts), which asks whether the `surfaces` declaration
 * permits THIS bind. `refarm web serve`, `refarm serve` and farmhand's CRDT relay have all
 * moved. The ONE listener still on this criterion is `serveCapabilities`
 * (`packages/capabilities-v1/src/mount.ts`), the SDK primitive a white-label app mounts: its
 * host comes from its consumer rather than from a flag, so which declaration it should read is
 * a question about that consumer's layout, not about this guard.
 *
 * - loopback ⇒ always allowed, policy or not. This is the default and is UNCHANGED by the guard.
 * - non-loopback + a policy configured ⇒ allowed — the operator opted into the identity gate
 *   before opening the bind beyond loopback.
 * - non-loopback + no policy ⇒ refused, naming the fix rather than just the refusal.
 *
 * `surface` names the listener in the message, so an operator hitting this in a consuming app
 * learns WHICH of their listeners refused, not merely that something did.
 */
export function refuseUnguardedNonLoopbackBind(
	host: string,
	authPolicyPresent: boolean,
	surface = "listener",
): string | null {
	if (authPolicyPresent || isLoopbackBindHost(host)) return null;
	return (
		`refusing to bind ${surface} to non-loopback host ${JSON.stringify(host)} with no auth ` +
		"policy configured — an unauthenticated listener reachable from other devices is not a " +
		"default this surface will pick for you. Mint a per-device credential with " +
		"`refarm auth enroll`, then point this surface at the resulting policy file via " +
		"REFARM_AUTH_POLICY before binding beyond loopback (or pass an explicit loopback host). " +
		"Note the refarm daemon DERIVES that path from its own `gate` declaration and needs no " +
		"env var; a TypeScript surface still resolves it from the environment."
	);
}

/**
 * Throwing form of {@link refuseUnguardedNonLoopbackBind} — the shape a `listen()` call site
 * wants, since there is nothing sensible to return when the bind is refused. Returns the decision
 * so the caller can log what it actually bound.
 */
export function assertBindAllowed(
	host: string,
	authPolicyPresent: boolean,
	surface = "listener",
): BindDecision {
	const refusal = refuseUnguardedNonLoopbackBind(host, authPolicyPresent, surface);
	if (refusal) throw new Error(refusal);
	return { host, loopback: isLoopbackBindHost(host) };
}

/**
 * The loopback default every Node listener in the substrate binds when the caller says nothing.
 * Exported as a named constant so "what is the default" has ONE answer a test can assert, rather
 * than a string literal repeated at each `listen()` call site.
 */
export const DEFAULT_BIND_HOST = "127.0.0.1";
