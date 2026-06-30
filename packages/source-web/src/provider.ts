import {
	SOURCE_CAPABILITY,
	type MaterializeOptions,
	type SourceLocation,
	type SourceStatus,
} from "@refarm.dev/source-contract-v1";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type {
	WebSourceMaterializeResult,
	WebSourceProvenance,
	WebSourceProvider,
	WebSourceSnapshot,
} from "./types.js";

const DEFAULT_CAPTURED_AT = "2026-06-30T00:00:00.000Z";

export interface WebSourceProviderOptions {
	pluginId?: string;
	cacheRoot?: string;
	fixtures?: Record<string, WebSourceSnapshot>;
	now?: () => string;
}

export const DEFAULT_WEB_SOURCE_FIXTURE: WebSourceSnapshot = {
	identity: "requirements-fixture",
	url: "https://example.invalid/refarm/requirements",
	mediaType: "text/html",
	body: [
		"<!doctype html>",
		"<html><body>",
		"<article data-record='REQ-1'>Requirements root</article>",
		"<article data-record='REQ-2'>Requirements child</article>",
		"</body></html>",
	].join(""),
	session: {
		kind: "fixture",
		authenticated: true,
		principal: "fixture-operator",
		startedAt: DEFAULT_CAPTURED_AT,
		expiresAt: "2026-06-30T01:00:00.000Z",
		credentialRef: "silo://fixture/web-session",
	},
	pacing: {
		maxRequestsPerMinute: 12,
		backoffMs: 500,
		userAgent: "refarm-source-web-fixture",
	},
	redaction: {
		applied: true,
		fields: ["cookie", "authorization", "set-cookie"],
	},
	capturedAt: DEFAULT_CAPTURED_AT,
};

function defaultCacheRoot(): string {
	return path.join(os.tmpdir(), "refarm-source-web");
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
			left.localeCompare(right),
		);
		return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
	}

	return JSON.stringify(value);
}

function sha256(value: unknown): string {
	return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function sanitizeSegment(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96) || "snapshot";
}

function parseWebRef(ref: string): { identity: string; sourceRef: string } {
	const trimmed = ref.trim();
	if (trimmed.length === 0) {
		throw new Error("INVALID_REF: web source ref must be non-empty");
	}

	if (trimmed.startsWith("web:")) {
		const identity = trimmed.slice("web:".length).trim();
		if (identity.length === 0) {
			throw new Error("INVALID_REF: web source identity must be non-empty");
		}
		return { identity, sourceRef: trimmed };
	}

	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		const url = new URL(trimmed);
		return {
			identity: `${url.host}${url.pathname}`.replace(/\/+$/g, "") || url.host,
			sourceRef: trimmed,
		};
	}

	throw new Error("UNSUPPORTED_KIND: source-web supports web: refs and http(s) fixture refs");
}

function fixtureFor(
	identity: string,
	sourceRef: string,
	fixtures: Record<string, WebSourceSnapshot>,
	now: () => string,
): WebSourceSnapshot {
	const fixture = fixtures[identity] ?? fixtures["requirements-fixture"] ?? DEFAULT_WEB_SOURCE_FIXTURE;
	return {
		...fixture,
		identity,
		url: sourceRef.startsWith("http") ? sourceRef : fixture.url,
		capturedAt: fixture.capturedAt || now(),
		session: {
			...fixture.session,
			startedAt: fixture.session.startedAt ?? now(),
		},
	};
}

function provenanceFor(
	snapshot: WebSourceSnapshot,
	sourceRef: string,
	offlineReplay: boolean,
): WebSourceProvenance {
	const cache = {
		identity: snapshot.identity,
		ref: sourceRef,
		capturedAt: snapshot.capturedAt,
		hash: sha256({
			identity: snapshot.identity,
			url: snapshot.url,
			mediaType: snapshot.mediaType,
			body: snapshot.body,
			redaction: snapshot.redaction,
		}),
		offlineReplay,
	};
	return {
		session: snapshot.session,
		pacing: snapshot.pacing,
		cache,
		redaction: snapshot.redaction,
	};
}

function locationFor(cacheRoot: string, identity: string): SourceLocation {
	return {
		kind: "local",
		path: path.join(cacheRoot, sanitizeSegment(identity)),
	};
}

async function readProvenance(snapshotPath: string): Promise<WebSourceProvenance | undefined> {
	try {
		const raw = await readFile(path.join(snapshotPath, "provenance.json"), "utf8");
		return JSON.parse(raw) as WebSourceProvenance;
	} catch {
		return undefined;
	}
}

async function writeSnapshot(
	snapshotPath: string,
	snapshot: WebSourceSnapshot,
	provenance: WebSourceProvenance,
): Promise<void> {
	await mkdir(snapshotPath, { recursive: true });
	await writeFile(path.join(snapshotPath, "content.html"), snapshot.body);
	await writeFile(
		path.join(snapshotPath, "snapshot.json"),
		`${JSON.stringify({
			identity: snapshot.identity,
			url: snapshot.url,
			mediaType: snapshot.mediaType,
			capturedAt: snapshot.capturedAt,
			contentPath: "content.html",
		}, null, 2)}\n`,
	);
	await writeFile(path.join(snapshotPath, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
}

export function createWebSourceProvider(
	options: WebSourceProviderOptions = {},
): WebSourceProvider {
	const cacheRoot = options.cacheRoot ?? defaultCacheRoot();
	const fixtures = options.fixtures ?? { [DEFAULT_WEB_SOURCE_FIXTURE.identity]: DEFAULT_WEB_SOURCE_FIXTURE };
	const now = options.now ?? (() => DEFAULT_CAPTURED_AT);

	function locate(ref: string): { sourceRef: string; identity: string; location: SourceLocation } {
		const parsed = parseWebRef(ref);
		return {
			...parsed,
			location: locationFor(cacheRoot, parsed.identity),
		};
	}

	async function materialize(
		ref: string,
		opts?: MaterializeOptions,
	): Promise<WebSourceMaterializeResult> {
		const { sourceRef, identity, location } = locate(ref);
		const existing = existsSync(path.join(location.path, "snapshot.json"));
		if (existing && opts?.force !== true) {
			const provenance = await readProvenance(location.path);
			return {
				location,
				action: opts?.offline === true ? "noop" : "reused",
				head: provenance?.cache.hash,
				stale: false,
				web: provenance ?? provenanceFor(fixtureFor(identity, sourceRef, fixtures, now), sourceRef, true),
			};
		}

		const snapshot = fixtureFor(identity, sourceRef, fixtures, now);
		const provenance = provenanceFor(snapshot, sourceRef, opts?.offline === true);
		await writeSnapshot(location.path, snapshot, provenance);
		return {
			location,
			action: existing ? "fetched" : "cloned",
			head: provenance.cache.hash,
			stale: false,
			web: provenance,
		};
	}

	return {
		pluginId: options.pluginId ?? "@refarm.dev/source-web",
		capability: SOURCE_CAPABILITY,
		kinds: ["local"],

		async resolve(ref: string): Promise<SourceLocation> {
			return locate(ref).location;
		},

		materialize,

		async status(ref: string): Promise<SourceStatus> {
			const { location } = locate(ref);
			const snapshotPath = path.join(location.path, "snapshot.json");
			if (!existsSync(snapshotPath)) {
				return { kind: "local", materialized: false, path: location.path };
			}
			const provenance = await readProvenance(location.path);
			const mtime = statSync(snapshotPath).mtime;
			return {
				kind: "local",
				materialized: true,
				path: location.path,
				stale: false,
				clean: true,
				dirty: false,
				untracked: false,
				head: provenance?.cache.hash,
				lastFetchedAt: provenance?.cache.capturedAt ?? mtime.toISOString(),
			};
		},

		async refresh(ref: string, opts?: MaterializeOptions): Promise<WebSourceMaterializeResult> {
			return materialize(ref, { ...opts, force: true });
		},

		async snapshotProvenance(ref: string): Promise<WebSourceProvenance | undefined> {
			const { location } = locate(ref);
			return readProvenance(location.path);
		},
	};
}
