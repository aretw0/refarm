import {
	createProcessHandoffDisplay,
	runProcessHandoffSync,
} from "@refarm.dev/cli/process-handoff";
import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	anySurfaceDeclaresDeviceTokenGate,
	isLoopbackBindHost,
	parseSurfaces,
	resolveDeclaredSurfaceBind,
	SURFACE_WEB,
	type SurfaceBindResolution,
	type SurfaceCatalog,
	type TailnetSelfResolution,
} from "@refarm.dev/std";
import { authPolicyPresent } from "@refarm.dev/std/node";

/**
 * Where `refarm web serve` gets its bind host — from the DECLARATION, not from a policy file
 * existing somewhere (O5, docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md).
 *
 * The surface is `web`, named for the LISTENER. `refarm web serve` is one listener carrying
 * the dist artifacts AND proxies to the daemon's WS (`127.0.0.1:42000`) and HTTP sidecar
 * (`127.0.0.1:42001`); O6 is explicit that declaring it open opens all of them, which is why
 * there is no second surface name for "just the artifacts".
 *
 * Three questions are answered here, in order:
 *
 * 1. WHAT DID THE OPERATOR DECLARE — read from the FILESYSTEM `.refarm/config.json` and never
 *    from the replicated config node. Exposure decides how THIS machine is reachable, so a
 *    declaration replicated from another device must never decide it; `surfaces_decl.rs` states
 *    the same doctrine and `resolve_connections` established it.
 * 2. WHAT ADDRESS IS THAT, CONCRETELY — `expose: "tailnet"` is INTENT (S2), never an address at
 *    parse time. It is resolved HERE, at bind time, by asking Tailscale — the same split the
 *    Rust `sidecar::tailnet_resolve` makes, including its distinction between "the tailnet is
 *    down" (a trustworthy answer that is not usable) and "I could not ask".
 * 3. MAY THIS BIND HAPPEN — `resolveDeclaredSurfaceBind` (S1/S3/S5, and the order in which they
 *    are asked) plus O6's extra clause below, which is about the surfaces this one proxies TO.
 *
 * Questions 1 and 3 are NOT web-specific and are not written here: they live in
 * `@refarm.dev/std` so `refarm serve` and farmhand's CRDT relay obey the same rule from the same
 * code. What stays in this file is what is genuinely local — asking Tailscale through the app's
 * process boundary, reading the app's config root, and O6.
 */

/** The gate the PROXIED upstreams enforce, and whether it is actually live right now.
 *
 * O6: "a proxy route whose upstream has no gate may not be served on an open surface at all."
 * The upstreams — the sidecar's `auth_middleware` and ADR-093's WS handshake — both enforce
 * against ONE node-wide `auth-policy.json`, and both fall through to passthrough when no policy
 * resolves. So an open `web` surface on a node with no credential policy would proxy the
 * tailnet straight into an ungated sidecar. That is the one machine-level fact this bind still
 * depends on, and it is a question about the UPSTREAM, not about `web` (which verifies nothing
 * and never will — that is what `gate: "none"` says out loud).
 *
 * Two ways it can be true, mirroring how the daemon itself resolves the policy path: a declared
 * `device-token` gate on any surface DERIVES `<refarm-dir>/auth-policy.json`
 * (`any_surface_declares_device_token_gate`), or `REFARM_AUTH_POLICY` names one explicitly. */
export function proxiedUpstreamsAreGated(
	surfaces: SurfaceCatalog,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return anySurfaceDeclaresDeviceTokenGate(surfaces) || authPolicyPresent(env);
}

/** Read the `surfaces` catalog from the FILESYSTEM `.refarm/config.json` under `root`.
 *  A malformed declaration THROWS (fail-shut, like `parse_surfaces`); an absent or unreadable
 *  file is S1's silence — an empty catalog, every surface loopback. */
// os-resolution: node — surfaces are how the NODE exposes itself; the config tier table marks them node-owned and not requestable
export function readSurfacesFromFilesystem(root = process.cwd()): SurfaceCatalog {
	// loadRawSovereignConfig reads the local file ONLY — it never consults the replicated
	// config node. That is the point, not an incidental property of the helper.
	return parseSurfaces(loadRawSovereignConfig(root));
}

/** What asking Tailscale for THIS machine's address produced — re-exported from `@refarm.dev/std`,
 *  where the bind rule that consumes it lives. */
export type { TailnetSelfResolution };

/** This machine's own tailnet IPv4, by asking `tailscale status --json` — the only one of the
 *  ways to ask that explains a failure instead of merely exiting non-zero.
 *
 *  Routed through the process-handoff adapter, never `node:child_process` directly (the app
 *  source keeps the process boundary — test/architecture/process-boundary.test.ts). */
export function resolveTailnetSelfIpv4(): TailnetSelfResolution {
	const args = ["status", "--json"];
	let stdout: string;
	try {
		const result = runProcessHandoffSync(
			{ command: "tailscale", args, display: createProcessHandoffDisplay("tailscale", args) },
			{ capture: true, timeout: 4000 },
		);
		if (result.exitCode !== 0) {
			return { ok: false, reason: "unreachable", detail: "`tailscale status --json` failed" };
		}
		stdout = result.stdout ?? "";
	} catch {
		return {
			ok: false,
			reason: "unreachable",
			detail: "the `tailscale` CLI could not be run (is it installed and on PATH?)",
		};
	}
	return parseTailnetSelfIpv4(stdout);
}

/** The PURE half of {@link resolveTailnetSelfIpv4} — classify `tailscale status --json` output.
 *  Exported so every branch is testable without a tailnet and without spawning anything. */
export function parseTailnetSelfIpv4(stdout: string): TailnetSelfResolution {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return {
			ok: false,
			reason: "unreachable",
			detail: "`tailscale status --json` did not print JSON",
		};
	}
	if (parsed === null || typeof parsed !== "object") {
		return {
			ok: false,
			reason: "unreachable",
			detail: "`tailscale status --json` printed JSON that is not a status document",
		};
	}
	const doc = parsed as {
		BackendState?: unknown;
		Self?: { Online?: unknown; TailscaleIPs?: unknown };
	};
	if (!("Self" in doc) && !("BackendState" in doc)) {
		return {
			ok: false,
			reason: "unreachable",
			detail: "`tailscale status --json` printed JSON that is not a status document",
		};
	}
	// A COMPLETE, trustworthy answer that simply is not usable: Tailscale answered, and this
	// machine is not on the tailnet right now. Distinct from "I could not ask" because the fix
	// is different — `tailscale up`, not installing anything.
	if (doc.BackendState !== undefined && doc.BackendState !== "Running") {
		return {
			ok: false,
			reason: "down",
			detail: `the tailnet is not running (BackendState=${String(doc.BackendState)})`,
		};
	}
	if (doc.Self?.Online === false) {
		return { ok: false, reason: "down", detail: "this machine is offline on the tailnet" };
	}
	const ips = Array.isArray(doc.Self?.TailscaleIPs) ? doc.Self.TailscaleIPs : [];
	const ipv4 = ips.find((ip): ip is string => typeof ip === "string" && /^\d+(\.\d+){3}$/.test(ip));
	if (!ipv4) {
		return { ok: false, reason: "down", detail: "this machine has no tailnet IPv4 address" };
	}
	return { ok: true, ipv4 };
}

export type WebBindResolution = SurfaceBindResolution;

export interface ResolveWebBindHostInput {
	/** The `--host` value the operator actually passed, or `undefined` when they passed none.
	 *  `undefined` is load-bearing — see `resolveDeclaredBindHost`'s note on defaulted flags. */
	readonly flagHost?: string | undefined;
	readonly surfaces: SurfaceCatalog;
	/** Seam: resolve this machine's tailnet IPv4. Injected so the decision is testable without
	 *  a tailnet and without ever spawning `tailscale`. */
	readonly resolveTailnet?: () => TailnetSelfResolution;
	readonly env?: NodeJS.ProcessEnv;
}

/**
 * Decide the `web` surface's bind host, or throw the refusal. Never binds a socket, never
 * reads disk; the only I/O it can perform is the injected tailnet resolution, and only when a
 * `tailnet` declaration is actually in play and the flag is not already loopback.
 */
export function resolveWebBindHost(input: ResolveWebBindHostInput): WebBindResolution {
	const { flagHost, surfaces, resolveTailnet = resolveTailnetSelfIpv4, env = process.env } = input;

	const { host, declared } = resolveDeclaredSurfaceBind({
		surface: SURFACE_WEB,
		surfaces,
		flagHost,
		label: "the hub (`refarm web serve`)",
		resolveTailnet,
	});

	// O6 — the proxy routes ride this same listener. Artifact routes are read-only and open by
	// declaration; the proxies are only admissible because their UPSTREAMS gate them, so an
	// open surface on a node with no credential policy is exactly the case O6 forbids.
	if (!isLoopbackBindHost(host) && !proxiedUpstreamsAreGated(surfaces, env)) {
		throw new Error(
			`refusing to bind the hub (\`refarm web serve\`) to ${JSON.stringify(host)}: this one ` +
				"listener also proxies /sync to the daemon's CRDT WebSocket and the sidecar API to " +
				"127.0.0.1:42001, and declaring the surface open opens those routes too. They are " +
				"admissible only because their UPSTREAM gates them — and no credential policy is " +
				"live on this node, so nothing would. Mint one with `refarm auth enroll` and declare " +
				'`"surfaces": { "sidecar-http": { "expose": "loopback", "gate": "device-token" } }`, ' +
				"or keep this bind on loopback.",
		);
	}

	return { host, declared };
}
