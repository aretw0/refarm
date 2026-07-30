import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	tailnetPeersReport,
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
			const report = await tailnetPeersReport({ run: options.run });
			return reportToCandidates(report);
		},
	};
}

/**
 * Turn a tailnet answer into candidates and notices. PURE — the whole C2.3 split
 * lives here and is unit-testable without a tailnet.
 *
 * Three distinct operator-visible outcomes, never collapsed into each other:
 *   - peers      ⇒ candidates, no notice.
 *   - no-peers   ⇒ NO candidates + "your tailnet answered: nobody else is on it".
 *   - not ok     ⇒ NO candidates + "could not ask your tailnet (<why>)".
 * The last two are the difference between "you have no devices" and "Tailscale
 * is not running" — different truths, different next actions.
 */
export function reportToCandidates(report: TailnetPeersReport): IdentityCandidateReport {
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
		const candidate = toCandidate(raw);
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
 * A name nothing can repair is not offered at all (the caller says so). */
function toCandidate(raw: string): IdentityCandidate | null {
	try {
		const valid = validateIdentityLabel(raw);
		return {
			value: valid,
			label: valid,
			description: "on your tailnet",
			source: TAILNET_IDENTITY_SOURCE_ID,
		};
	} catch {
		const repaired = sanitiseIdentityLabel(raw);
		if (!repaired) return null;
		return {
			value: repaired,
			label: repaired,
			description: "on your tailnet, name adjusted",
			needsConfirmation: true,
			rawName: raw,
			source: TAILNET_IDENTITY_SOURCE_ID,
		};
	}
}
