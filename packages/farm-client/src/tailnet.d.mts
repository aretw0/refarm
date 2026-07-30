/**
 * Types for `tailnet.mjs`. Hand-written (this package is JS-Atomic and stays
 * zero-dependency — nothing here is generated, and nothing here is a build
 * artifact): a declaration file is the only way a TS consumer can call the
 * module without `any`, and `apps/refarm`'s extended enrolment path is that
 * consumer. Keep in lockstep with `tailnet.mjs`.
 */

/** A peer as the four zero-dependency callers have always received it. */
export interface TailnetPeer {
	name: string;
	ip: string;
}

/** The full record the single parse produces; `TailnetPeer` is its projection. */
export interface TailnetPeerRecord extends TailnetPeer {
	/** The raw MagicDNS name, e.g. `phone.tail894688.ts.net.` — null when absent. */
	dnsName: string | null;
	/** The short MagicDNS handle, e.g. `phone` — null when there is no DNSName. */
	shortName: string | null;
	online: boolean;
}

export interface TailnetParseOptions {
	includeOffline?: boolean;
}

/** Why a report carries no peers — "the answer is no" vs "I could not ask". */
export type TailnetPeersReason =
	| "peers"
	| "no-peers"
	| "cli-missing"
	| "query-failed"
	| "bad-output";

export interface TailnetPeersReport {
	/** True only when Tailscale actually answered (`peers` or `no-peers`). */
	ok: boolean;
	reason: TailnetPeersReason;
	peers: TailnetPeerRecord[];
	/** Human-readable explanation, present only when `ok` is false. */
	detail: string | null;
}

/** Injectable `tailscale` runner — resolves the command's stdout. */
export type TailnetRunner = (args: string[]) => Promise<string>;

export interface TailnetQueryOptions extends TailnetParseOptions {
	run?: TailnetRunner;
}

export function parseTailnetPeerRecords(
	status: unknown,
	options?: TailnetParseOptions,
): TailnetPeerRecord[];
export function parseTailnetPeers(status: unknown, options?: TailnetParseOptions): TailnetPeer[];
export function tailnetShortName(dnsName: unknown): string | null;
export function tailnetStatusReport(
	stdout: string,
	options?: TailnetParseOptions,
): TailnetPeersReport;
export function tailnetPeersReport(options?: TailnetQueryOptions): Promise<TailnetPeersReport>;
export function tailnetPeers(options?: TailnetQueryOptions): Promise<TailnetPeer[]>;
