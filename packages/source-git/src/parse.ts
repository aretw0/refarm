import type { SourceKind } from "@refarm.dev/source-contract-v1";
import os from "node:os";
import path from "node:path";

export interface ParsedRef {
	kind: SourceKind;
	host?: string;
	org?: string;
	repo?: string;
	gitref?: string;
	sourcePath?: string;
}

function stripGitSuffix(value: string): string {
	return value.endsWith(".git") ? value.slice(0, -4) : value;
}

export function parseSourceRef(ref: string): ParsedRef {
	const trimmed = ref.trim();
	if (trimmed.length === 0) {
		throw new Error("INVALID_REF: empty ref");
	}

	if (trimmed.startsWith("local:")) {
		const sourcePath = trimmed.slice("local:".length);
		return { kind: "local", repo: path.basename(stripGitSuffix(sourcePath)), sourcePath };
	}

	const scp = /^git@([^:]+):([^/]+)\/(.+)$/.exec(trimmed);
	if (scp) {
		return { kind: "git", host: scp[1]!, org: scp[2]!, repo: stripGitSuffix(scp[3]!) };
	}

	if (/^https?:\/\//.test(trimmed)) {
		const url = new URL(trimmed);
		const segments = url.pathname.replace(/^\/+/, "").split("/");
		if (segments.length < 2) throw new Error(`INVALID_REF: ${ref}`);
		return { kind: "git", host: url.host, org: segments[0]!, repo: stripGitSuffix(segments[1]!) };
	}

	if (trimmed.startsWith("file://") || trimmed.startsWith("/") || trimmed.endsWith(".git")) {
		const localPath = trimmed.replace(/^file:\/\//, "");
		const repo = path.basename(stripGitSuffix(localPath));
		return { kind: "git", host: "local", org: "_", repo };
	}

	const segments = stripGitSuffix(trimmed).split("/");
	if (segments.length === 2) {
		return { kind: "git", host: "github.com", org: segments[0]!, repo: segments[1]! };
	}
	if (segments.length === 3) {
		return { kind: "git", host: segments[0]!, org: segments[1]!, repo: segments[2]! };
	}
	throw new Error(`INVALID_REF: ${ref}`);
}

export function defaultCacheRoot(): string {
	return path.join(os.homedir(), ".cache", "checkouts");
}

export function cachePathFor(parsed: ParsedRef, cacheRoot: string): string {
	if (parsed.kind === "local") return parsed.sourcePath ?? "";
	return path.join(cacheRoot, parsed.host ?? "unknown", parsed.org ?? "_", parsed.repo ?? "_");
}
