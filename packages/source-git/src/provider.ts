import {
	SOURCE_CAPABILITY,
	type MaterializeOptions,
	type MaterializeResult,
	type SourceLocation,
	type SourceProvider,
	type SourceStatus,
} from "@refarm.dev/source-contract-v1";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { fetchAndMaybeFastForward, headCommit, isClean, partialClone } from "./git.js";
import { cachePathFor, defaultCacheRoot, parseSourceRef, type ParsedRef } from "./parse.js";

const DEFAULT_STALE_SECONDS = 300;
const DEFAULT_FILTER = "blob:none";

export interface GitSourceProviderOptions {
	cacheRoot?: string;
	pluginId?: string;
}

export function createGitSourceProvider(opts: GitSourceProviderOptions = {}): SourceProvider {
	const cacheRoot = opts.cacheRoot ?? defaultCacheRoot();

	function locate(ref: string): { parsed: ParsedRef; path: string } {
		const parsed = parseSourceRef(ref);
		if (parsed.kind !== "git") {
			throw new Error("UNSUPPORTED_KIND: source-git only supports kind 'git'");
		}
		return { parsed, path: cachePathFor(parsed, cacheRoot) };
	}

	function locationOf(parsed: ParsedRef, repoPath: string): SourceLocation {
		return {
			kind: "git",
			host: parsed.host,
			org: parsed.org,
			repo: parsed.repo,
			path: repoPath,
		};
	}

	function remoteFor(ref: string, parsed: ParsedRef): string {
		const trimmed = ref.trim();
		if (
			trimmed.startsWith("http://") ||
			trimmed.startsWith("https://") ||
			trimmed.startsWith("git@") ||
			trimmed.startsWith("file://") ||
			trimmed.startsWith("/") ||
			trimmed.endsWith(".git")
		) {
			return trimmed;
		}
		return `https://${parsed.host}/${parsed.org}/${parsed.repo}.git`;
	}

	function isStale(repoPath: string, staleSeconds: number): boolean {
		try {
			const ageMs = Date.now() - statSync(path.join(repoPath, ".git")).mtimeMs;
			return ageMs > staleSeconds * 1000;
		} catch {
			return true;
		}
	}

	async function materialize(
		ref: string,
		options?: MaterializeOptions,
	): Promise<MaterializeResult> {
		const { parsed, path: dest } = locate(ref);
		const filter = options?.filter ?? DEFAULT_FILTER;
		const staleSeconds = options?.staleSeconds ?? DEFAULT_STALE_SECONDS;
		const location = locationOf(parsed, dest);

		if (!existsSync(dest)) {
			await partialClone(remoteFor(ref, parsed), dest, filter);
			return { location, action: "cloned", head: await headCommit(dest), stale: false };
		}

		const stale = options?.force === true || isStale(dest, staleSeconds);
		if (!stale) {
			return { location, action: "reused", head: await headCommit(dest), stale: false };
		}
		if (options?.offline === true) {
			return { location, action: "noop", head: await headCommit(dest), stale: true };
		}
		const action = await fetchAndMaybeFastForward(dest);
		return { location, action, head: await headCommit(dest), stale: true };
	}

	return {
		pluginId: opts.pluginId ?? "@refarm.dev/source-git",
		capability: SOURCE_CAPABILITY,
		kinds: ["git"],

		async resolve(ref: string): Promise<SourceLocation> {
			const { parsed, path: repoPath } = locate(ref);
			return locationOf(parsed, repoPath);
		},

		materialize,

		async status(ref: string): Promise<SourceStatus> {
			const { path: dest } = locate(ref);
			if (!existsSync(dest)) {
				return { kind: "git", materialized: false, path: dest };
			}
			return {
				kind: "git",
				materialized: true,
				path: dest,
				clean: await isClean(dest),
				head: await headCommit(dest),
			};
		},

		async refresh(ref: string, options?: MaterializeOptions): Promise<MaterializeResult> {
			return materialize(ref, { ...options, force: true });
		},
	};
}
