import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type {
	WebSourcePacingPolicy,
	WebSourceRedactionReport,
	WebSourceSessionEvidence,
	WebSourceSnapshot,
} from "./types.js";

/**
 * CONFIG-DRIVEN source targets — the block that lets a user declare THEIR OWN sources in a
 * ledger instead of an app hardcoding them. An analyst who has access to different systems
 * than the next analyst writes their targets into a config file (e.g. `.dgk/sources.json`);
 * `loadWebSourceTargets` reads it into the snapshot map `createWebSourceProvider` already
 * consumes, so `discover()` lists exactly the systems THAT user configured. This is "configure
 * the minimum, the rest happens": the example ships no systems; the user brings theirs.
 *
 * HOW a target is fetched stays behind the session/body seam. Today a target carries an
 * inline `body` (a captured/fixtured snapshot) so it works offline and is testable; a real
 * browser driver (a light CDP/WebDriver client — chosen later) would populate `body` from a
 * live authenticated session, filling the same snapshot shape. The config schema is stable
 * either way.
 */
export interface WebSourceTargetConfig {
	/** The system's identity — becomes the `web:<identity>` ref and the discover label. */
	identity: string;
	/** The system's URL (what the analyst pulls from). */
	url: string;
	/** A human label for discover (defaults to identity). */
	label?: string;
	/** The captured body for offline/fixture mode. A real driver fills this from a session. */
	body?: string;
	/** Media type of the body (default "text/html"). */
	mediaType?: string;
	/** Session evidence — auth/principal/credentialRef. Defaults to an unauthenticated
	 * fixture session; a login flow (block 3) supplies the real one. */
	session?: Partial<WebSourceSessionEvidence>;
	/** Polite crawling limits (rate/backoff/user-agent). */
	pacing?: Partial<WebSourcePacingPolicy>;
	/** When this snapshot was captured (default now-injected or a fixed stamp). */
	capturedAt?: string;
	/** OPEN driver coordinates — arbitrary key/values the analyst's fetch driver needs, opaque
	 * to the substrate. E.g. an OSLC/Jazz driver reads `componentURI` / `streamURI` / `folderId`
	 * from here. This is what makes the config faithful without leaking a domain into refarm. */
	attributes?: Record<string, string>;
}

/** The file shape: a list of the analyst's configured source targets. */
export interface WebSourceTargetsConfig {
	targets: WebSourceTargetConfig[];
}

const DEFAULT_CAPTURED_AT = "2026-06-30T00:00:00.000Z";
const DEFAULT_PACING: WebSourcePacingPolicy = {
	maxRequestsPerMinute: 12,
	backoffMs: 500,
	userAgent: "refarm-source-web",
};
const DEFAULT_REDACTION: WebSourceRedactionReport = {
	applied: true,
	fields: ["cookie", "authorization", "set-cookie"],
};

/** Turn one declared target into the full snapshot the provider consumes. */
export function webSourceSnapshotFromTarget(
	target: WebSourceTargetConfig,
	now: () => string = () => DEFAULT_CAPTURED_AT,
): WebSourceSnapshot {
	const capturedAt = target.capturedAt ?? now();
	const session: WebSourceSessionEvidence = {
		kind: target.session?.kind ?? "fixture",
		authenticated: target.session?.authenticated ?? true,
		...(target.session?.principal ? { principal: target.session.principal } : {}),
		startedAt: target.session?.startedAt ?? capturedAt,
		...(target.session?.expiresAt ? { expiresAt: target.session.expiresAt } : {}),
		...(target.session?.credentialRef ? { credentialRef: target.session.credentialRef } : {}),
	};
	return {
		identity: target.identity,
		url: target.url,
		mediaType: target.mediaType ?? "text/html",
		body: target.body ?? "",
		session,
		pacing: { ...DEFAULT_PACING, ...target.pacing },
		redaction: DEFAULT_REDACTION,
		capturedAt,
		...(target.attributes ? { attributes: target.attributes } : {}),
	};
}

/** Build the identity→snapshot map the provider takes, from a parsed config. */
export function webSourceFixturesFromConfig(
	config: WebSourceTargetsConfig,
	now?: () => string,
): Record<string, WebSourceSnapshot> {
	const out: Record<string, WebSourceSnapshot> = {};
	for (const target of config.targets) {
		out[target.identity] = webSourceSnapshotFromTarget(target, now);
	}
	return out;
}

/** Parse a config object (from JSON) into the validated targets config. Throws on a shape
 * that isn't `{ targets: [{ identity, url, … }] }`. */
export function parseWebSourceTargetsConfig(raw: unknown): WebSourceTargetsConfig {
	if (!raw || typeof raw !== "object" || !Array.isArray((raw as { targets?: unknown }).targets)) {
		throw new Error("INVALID_CONFIG: expected { targets: [...] }");
	}
	const targets = (raw as { targets: unknown[] }).targets.map(
		(entry, index): WebSourceTargetConfig => {
			if (!entry || typeof entry !== "object") {
				throw new Error(`INVALID_CONFIG: targets[${index}] must be an object`);
			}
			const { identity, url } = entry as Record<string, unknown>;
			if (typeof identity !== "string" || identity.trim().length === 0) {
				throw new Error(`INVALID_CONFIG: targets[${index}].identity must be a non-empty string`);
			}
			if (typeof url !== "string" || url.trim().length === 0) {
				throw new Error(`INVALID_CONFIG: targets[${index}].url must be a non-empty string`);
			}
			return entry as WebSourceTargetConfig;
		},
	);
	return { targets };
}

/**
 * Read the analyst's source targets from a config file (e.g. `.dgk/sources.json`) into the
 * snapshot map the provider consumes. The app passes the result as `createWebSourceProvider({
 * fixtures })` — so `discover()` lists the user's own systems. Returns an empty map if the
 * file is missing (a fresh install has no configured sources yet).
 */
export async function loadWebSourceTargets(
	configPath: string,
	now?: () => string,
): Promise<Record<string, WebSourceSnapshot>> {
	let text: string;
	try {
		text = await readFile(configPath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	const config = parseWebSourceTargetsConfig(JSON.parse(text));
	return webSourceFixturesFromConfig(config, now);
}

/** Synchronous {@link loadWebSourceTargets} — for a host that resolves its sources at
 * startup (before an async boundary), reading a local config file. Same empty-on-missing
 * behaviour. */
export function loadWebSourceTargetsSync(
	configPath: string,
	now?: () => string,
): Record<string, WebSourceSnapshot> {
	let text: string;
	try {
		text = readFileSync(configPath, "utf-8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
	return webSourceFixturesFromConfig(parseWebSourceTargetsConfig(JSON.parse(text)), now);
}
