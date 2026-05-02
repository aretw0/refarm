import { readFileSync } from "node:fs";

const UNKNOWN_VERSION = "unknown";
const DEFAULT_PACKAGE_JSON_PATH = new URL(
	"../../package.json",
	import.meta.url,
);

let cachedVersion: string | undefined;

interface ResolveVersionOptions {
	env?: NodeJS.ProcessEnv;
	packageJsonPath?: URL | string;
	readPackageJson?: (path: URL | string) => string;
}

export interface RefarmRuntimeMetadata {
	app: string;
	command: string;
	profile: string;
	version: string;
}

export interface ResolveRefarmRuntimeMetadataOptions
	extends ResolveVersionOptions {
	app?: string;
	command?: string;
	profile?: string;
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

	if (cachedVersion) {
		return cachedVersion;
	}

	const readPackageJson =
		options?.readPackageJson ??
		((path: URL | string) => readFileSync(path, "utf8"));
	const packageJsonPath = options?.packageJsonPath ?? DEFAULT_PACKAGE_JSON_PATH;

	try {
		const raw = readPackageJson(packageJsonPath);
		const parsed = JSON.parse(raw) as { version?: unknown };
		const version =
			typeof parsed.version === "string" ? parsed.version.trim() : "";
		if (!version) {
			return UNKNOWN_VERSION;
		}
		cachedVersion = version;
		return version;
	} catch {
		return UNKNOWN_VERSION;
	}
}

export function resolveRefarmRuntimeMetadata(
	options?: ResolveRefarmRuntimeMetadataOptions,
): RefarmRuntimeMetadata {
	return {
		app: options?.app ?? "apps/refarm",
		command: options?.command ?? "refarm",
		profile: options?.profile ?? "dev",
		version: resolveVersion(options),
	};
}

export function resolveRefarmVersion(options?: ResolveVersionOptions): string {
	return resolveVersion(options);
}

export function __resetRefarmRuntimeMetadataCacheForTests(): void {
	cachedVersion = undefined;
}
