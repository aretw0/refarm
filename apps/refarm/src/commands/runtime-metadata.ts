import { detectPackageManager, type PackageManagerName } from "@refarm.dev/config";
import { readFileSync } from "node:fs";
import { makeProcessCache } from "../utils/process-cache.js";

const UNKNOWN_VERSION = "unknown";
const DEFAULT_PACKAGE_JSON_PATH = new URL("../../package.json", import.meta.url);

const versionCache = makeProcessCache<string>();

interface ResolveVersionOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	packageJsonPath?: URL | string;
	readPackageJson?: (path: URL | string) => string;
}

export interface RefarmHostIdentity {
	app: string;
	command: string;
	profile: string;
}

export interface RefarmRuntimeMetadata {
	app: string;
	command: string;
	profile: string;
	version: string;
	packageManager: PackageManagerName;
}

export interface ResolveRefarmRuntimeMetadataOptions extends ResolveVersionOptions {
	app?: string;
	command?: string;
	profile?: string;
}

export function resolveRefarmHostIdentity(
	options?: Pick<ResolveRefarmRuntimeMetadataOptions, "app" | "command" | "profile">,
): RefarmHostIdentity {
	return {
		app: options?.app ?? "apps/refarm",
		command: options?.command ?? "refarm",
		profile: options?.profile ?? "dev",
	};
}

function resolveVersion(options?: ResolveVersionOptions): string {
	const env = options?.env ?? process.env;
	const explicit = env.REFARM_VERSION?.trim();
	if (explicit) {
		return explicit;
	}

	const npmVersion = env.npm_package_version?.trim();
	if (npmVersion) {
		return npmVersion;
	}

	const cached = versionCache.get();
	if (cached) {
		return cached;
	}

	const readPackageJson =
		options?.readPackageJson ?? ((path: URL | string) => readFileSync(path, "utf8"));
	const packageJsonPath = options?.packageJsonPath ?? DEFAULT_PACKAGE_JSON_PATH;

	try {
		const raw = readPackageJson(packageJsonPath);
		const parsed = JSON.parse(raw) as { version?: unknown };
		const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
		if (!version) {
			return UNKNOWN_VERSION;
		}
		return versionCache.set(version);
	} catch {
		return UNKNOWN_VERSION;
	}
}

export function resolveRefarmRuntimeMetadata(
	options?: ResolveRefarmRuntimeMetadataOptions,
): RefarmRuntimeMetadata {
	const host = resolveRefarmHostIdentity(options);
	return {
		...host,
		version: resolveVersion(options),
		packageManager: detectPackageManager({
			cwd: options?.cwd ?? process.cwd(),
			env: options?.env ?? process.env,
		}),
	};
}

export function resolveRefarmVersion(options?: ResolveVersionOptions): string {
	return resolveVersion(options);
}

export function __resetRefarmRuntimeMetadataCacheForTests(): void {
	versionCache.clear();
}
