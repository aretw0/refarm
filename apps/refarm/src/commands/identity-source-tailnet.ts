import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	tailnetPeersReport,
	type TailnetPeerRecord,
	type TailnetPeersReport,
	type TailnetRunner,
} from "@refarm.dev/farm-client/tailnet";

import {
	sanitiseIdentityLabel,
	validateIdentityLabel,
	type IdentityCandidate,
	type IdentityCandidateReport,
	type IdentityCandidateSource,
} from "./identity-candidates.js";

/**
 * The EXTENDED enrolment source: when the operator has declared a tailnet
 * surface, offer the devices already on it, named as the tailnet names them
 * (docs/superpowers/specs/2026-07-30-canonical-and-extended-flows-design.md).
 *
 * Nothing here is reachable from the canonical flow. `auth.ts` asks a registry
 * for sources; this happens to be one of them. Delete this file and enrolment
 * still works, unchanged — that is the test of whether the seam is real.
 *
 * C3 — the gate is the DECLARATION, never detection. `expose: "tailnet"` in
 * `.refarm/config.json`'s `surfaces` is the only thing that unlocks the query.
 * A machine that merely HAS Tailscale installed and running gets the canonical
 * flow, and `tailscale` is never spawned. Detection decides HOW to satisfy a
 * declared intent; it never decides WHAT the operator wants.
 *
 * C2.4 — enrolment is not discovery. Offline peers are OFFERED here, clearly
 * marked, never filtered out: a credential minted today is for a device that
 * will use it later, and a device not yet enrolled is typically offline for
 * exactly that reason. `tailnetPeers`' online-only default is for `farm-hello`
 * and friends, who must reach a peer NOW — this source asks for the wider set
 * on purpose and marks each candidate with what it actually knows.
 */

export const TAILNET_IDENTITY_SOURCE_ID = "tailnet";

/** The `expose` value that unlocks this source. Matches the Rust parser's
 * vocabulary exactly (`packages/tractor/.../surfaces_decl.rs` `parse_expose`):
 * `"loopback" | "host:<ip>" | "tailnet"`. */
const TAILNET_EXPOSE = "tailnet";

/**
 * Does ANY declared surface say `expose: "tailnet"`? PURE — takes the already-read
 * config object, so the gate is testable without a filesystem.
 *
 * Deliberately not restricted to the two surfaces the Rust runtime knows today
 * (`sidecar-http`, `daemon-ws`): the question asked here is "has this operator
 * declared that this node lives on a tailnet", and a future TypeScript surface
 * declaring the same thing answers it just as well. A malformed or absent
 * `surfaces` block answers "no" — silence is closed (S1), never an invitation
 * to go looking.
 */
export function declaresTailnetSurface(config: unknown): boolean {
	if (config == null || typeof config !== "object") return false;
	const surfaces = (config as Record<string, unknown>).surfaces;
	if (surfaces == null || typeof surfaces !== "object" || Array.isArray(surfaces)) return false;
	for (const declaration of Object.values(surfaces as Record<string, unknown>)) {
		if (declaration == null || typeof declaration !== "object") continue;
		if ((declaration as Record<string, unknown>).expose === TAILNET_EXPOSE) return true;
	}
	return false;
}

export interface TailnetIdentitySourceOptions {
	/** Where `.refarm/config.json` lives. Defaults to the process cwd. */
	root?: string;
	/** Injected `tailscale` runner. Tests assert this is NEVER called when the
	 * surface is undeclared — that assertion is C3's teeth. */
	run?: TailnetRunner;
	/** Injected raw-config reader, for tests. Production uses the fs-only reader. */
	loadConfig?: (root: string) => Record<string, unknown> | null;
}

export function createTailnetIdentitySource(
	options: TailnetIdentitySourceOptions = {},
): IdentityCandidateSource {
	return {
		id: TAILNET_IDENTITY_SOURCE_ID,
		async collect(): Promise<IdentityCandidateReport> {
			const root = options.root ?? process.cwd();
			// FILESYSTEM ONLY, never the replicated config node (`resolveSovereignConfig`).
			// Exposure decides how THIS machine is reachable, so a declaration replicated
			// from another device over CRDT must never decide it — the same doctrine
			// `surfaces_decl.rs` states for the Rust side. It also means the gate costs
			// one `readFileSync` and never touches the runtime.
			const load = options.loadConfig ?? loadRawSovereignConfig;
			let config: Record<string, unknown> | null;
			try {
				config = load(root);
			} catch {
				config = null;
			}
			if (!declaresTailnetSurface(config)) {
				// C3: undeclared ⇒ we do not go looking. `run` is not called, the
				// `tailscale` CLI is not spawned, and the operator gets the canonical
				// flow with no evidence that this source exists.
				return { candidates: [], notices: [] };
			}
			// includeOffline: true — enrolment is not discovery (C2.4). `farm-hello`
			// needs a peer reachable NOW, so it keeps `tailnetPeers`' online-only
			// default untouched. Enrolment mints a credential the device will use
			// LATER, and a device not yet set up is typically offline for exactly
			// that reason — excluding it would make the feature inert on precisely
			// the tailnet it exists to help.
			const report = await tailnetPeersReport({ run: options.run, includeOffline: true });
			return reportToCandidates(report);
		},
	};
}

/**
 * Turn a tailnet answer into candidates and notices. PURE — the whole C2.3 split
 * lives here and is unit-testable without a tailnet. `now` is injectable so the
 * "last seen" rendering is deterministic in tests; production never passes it.
 *
 * Three distinct operator-visible outcomes, never collapsed into each other:
 *   - peers      ⇒ candidates, no notice. This is "peers" even when EVERY peer
 *     in it is offline (C2.4) — an all-offline tailnet is not the same answer
 *     as a tailnet with nobody on it at all.
 *   - no-peers   ⇒ NO candidates + "your tailnet answered: nobody else is on it".
 *   - not ok     ⇒ NO candidates + "could not ask your tailnet (<why>)".
 * The last two are the difference between "you have no devices" and "Tailscale
 * is not running" — different truths, different next actions.
 */
export function reportToCandidates(
	report: TailnetPeersReport,
	now: number = Date.now(),
): IdentityCandidateReport {
	if (!report.ok) {
		return {
			candidates: [],
			notices: [
				`Could not ask your tailnet which devices are on it (${report.detail ?? "unknown reason"}) — type a name below instead.`,
			],
		};
	}
	if (report.peers.length === 0) {
		return {
			candidates: [],
			notices: ["Your tailnet answered: no other devices are on it right now."],
		};
	}

	const candidates: IdentityCandidate[] = [];
	const notices: string[] = [];
	for (const peer of report.peers) {
		// NAME SOURCE: the short MagicDNS handle, falling back to the OS hostname.
		// MagicDNS is the name the operator already chose once and the one the rest
		// of refarm addresses the device by (`farm-hello <hostname>`); it is unique
		// within the tailnet and DNS-label-safe, where two devices may perfectly
		// well share a raw `HostName`. A credential identity must not be ambiguous.
		const raw = peer.shortName ?? peer.name;
		const candidate = toCandidate(peer, raw, now);
		if (!candidate) {
			notices.push(
				`Skipped a tailnet peer whose name cannot be used as a device label (${JSON.stringify(raw)}).`,
			);
			continue;
		}
		candidates.push(candidate);
	}
	return { candidates, notices };
}

/** A peer name that already passes label validation is offered as-is; one that
 * does not is offered REPAIRED and flagged for the operator to accept or edit.
 * A name nothing can repair is not offered at all (the caller says so).
 *
 * The qualifier suffix (empty for an online peer) is what makes an offline
 * candidate visually distinguishable from an online one in the same list —
 * neither is hidden, but only one reads as available right now. */
function toCandidate(peer: TailnetPeerRecord, raw: string, now: number): IdentityCandidate | null {
	const suffix = offlineSuffix(peer, now);
	try {
		const valid = validateIdentityLabel(raw);
		return {
			value: valid,
			label: valid,
			description: `on your tailnet${suffix}`,
			source: TAILNET_IDENTITY_SOURCE_ID,
		};
	} catch {
		const repaired = sanitiseIdentityLabel(raw);
		if (!repaired) return null;
		return {
			value: repaired,
			label: repaired,
			description: `on your tailnet, name adjusted${suffix}`,
			needsConfirmation: true,
			rawName: raw,
			source: TAILNET_IDENTITY_SOURCE_ID,
		};
	}
}

/** "" for an online peer; ", offline" — with "(last seen …)" appended when the
 * status document carried `LastSeen` for it — for one that is not. */
function offlineSuffix(peer: TailnetPeerRecord, now: number): string {
	if (peer.online) return "";
	const seen = formatLastSeen(peer.lastSeen, now);
	return seen ? `, offline (last seen ${seen})` : ", offline";
}

/** A short "Nd/Nh/Nm ago" from an ISO-8601 `LastSeen`. Never invents a value:
 * an absent or unparseable timestamp renders as null and the caller falls
 * back to the bare ", offline" mark. */
function formatLastSeen(lastSeen: string | null, now: number): string | null {
	if (!lastSeen) return null;
	const then = Date.parse(lastSeen);
	if (Number.isNaN(then)) return null;
	const elapsedMs = now - then;
	if (elapsedMs < 60_000) return "just now";
	const minutes = Math.floor(elapsedMs / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	return `${days}d ago`;
}
