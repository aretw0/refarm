import {
	SOURCE_CAPABILITY,
	type MaterializeOptions,
	type MaterializeResult,
	type SourceLocation,
	type SourceProvider,
	type SourceStatus,
} from "@refarm.dev/source-contract-v1";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const pexec = promisify(execFile);

export interface LocalSourceProviderOptions {
	pluginId?: string;
	cwd?: string;
}

function parseLocalRef(ref: string, cwd: string): string {
	const raw = ref.startsWith("local:") ? ref.slice("local:".length) : ref;
	if (!raw.trim()) {
		throw new Error("INVALID_REF: local source path must be non-empty");
	}
	return path.resolve(cwd, raw);
}

async function gitHead(repoPath: string): Promise<string | undefined> {
	try {
		const { stdout } = await pexec("git", ["-C", repoPath, "rev-parse", "HEAD"]);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function gitPorcelain(repoPath: string): Promise<string[] | undefined> {
	try {
		const { stdout } = await pexec("git", ["-C", repoPath, "status", "--porcelain"]);
		return stdout
			.split("\n")
			.map((line) => line.trimEnd())
			.filter(Boolean);
	} catch {
		return undefined;
	}
}

function untrackedPaths(lines: string[] | undefined): string[] | undefined {
	if (!lines) return undefined;
	const paths = lines
		.filter((line) => line.startsWith("?? "))
		.map((line) => line.slice(3).trim())
		.filter(Boolean);
	return paths.length > 0 ? paths : undefined;
}

export function createLocalSourceProvider(
	options: LocalSourceProviderOptions = {},
): SourceProvider {
	const cwd = options.cwd ?? process.cwd();

	function resolveLocation(ref: string): SourceLocation {
		return { kind: "local", path: parseLocalRef(ref, cwd) };
	}

	async function materialize(
		ref: string,
		_opts?: MaterializeOptions,
	): Promise<MaterializeResult> {
		const location = resolveLocation(ref);
		if (!existsSync(location.path)) {
			throw new Error(`NOT_MATERIALIZED: local source path does not exist: ${location.path}`);
		}
		return {
			location,
			action: "linked",
			head: await gitHead(location.path),
			stale: false,
		};
	}

	return {
		pluginId: options.pluginId ?? "@refarm.dev/source-local",
		capability: SOURCE_CAPABILITY,
		kinds: ["local"],

		async resolve(ref: string): Promise<SourceLocation> {
			return resolveLocation(ref);
		},

		materialize,

		async status(ref: string): Promise<SourceStatus> {
			const location = resolveLocation(ref);
			if (!existsSync(location.path)) {
				return { kind: "local", materialized: false, path: location.path };
			}
			const lines = await gitPorcelain(location.path);
			const untracked = untrackedPaths(lines);
			const dirty = lines ? lines.length > 0 : undefined;
			return {
				kind: "local",
				materialized: true,
				path: location.path,
				clean: lines ? lines.length === 0 : undefined,
				dirty,
				untracked: untracked ? untracked.length > 0 : undefined,
				untrackedPaths: untracked,
				head: await gitHead(location.path),
			};
		},

		async refresh(ref: string, opts?: MaterializeOptions): Promise<MaterializeResult> {
			return materialize(ref, { ...opts, force: true });
		},
	};
}
