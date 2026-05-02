import { readFileSync } from "node:fs";

const UNKNOWN_VERSION = "unknown";
const DEFAULT_PACKAGE_JSON_PATH = new URL(
	"../../package.json",
	import.meta.url,
);

let cachedVersion: string | undefined;

interface ResolveRefarmVersionOptions {
	env?: NodeJS.ProcessEnv;
	packageJsonPath?: URL | string;
	readPackageJson?: (path: URL | string) => string;
}

export function resolveRefarmVersion(
	options?: ResolveRefarmVersionOptions,
): string {
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

export function __resetRefarmVersionCacheForTests(): void {
	cachedVersion = undefined;
}
