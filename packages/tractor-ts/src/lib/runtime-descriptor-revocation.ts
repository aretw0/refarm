export interface RuntimeDescriptorRevocationList {
	schemaVersion: 1;
	updatedAt?: string;
	version?: string;
	revokedDescriptorHashes: string[];
	notes?: string;
}

export interface RuntimeDescriptorRevocationListReference {
	url: string;
}

export interface FetchRuntimeDescriptorRevocationOptions {
	fetchFn?: typeof fetch;
	cacheTtlMs?: number;
	allowStaleOnError?: boolean;
}

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const revocationListCache = new Map<
	string,
	{
		expiresAt: number;
		list: RuntimeDescriptorRevocationList;
	}
>();

function stripGitSuffix(repoName: string): string {
	return repoName.endsWith(".git") ? repoName.slice(0, -4) : repoName;
}

export function resolveGithubRepoCoordinates(
	sourceRepository: string | undefined,
): { owner: string; repo: string } | null {
	if (!sourceRepository) return null;

	try {
		if (sourceRepository.startsWith("git@github.com:")) {
			const value = sourceRepository.replace("git@github.com:", "");
			const [owner, repo] = value.split("/");
			if (!owner || !repo) return null;
			return {
				owner,
				repo: stripGitSuffix(repo),
			};
		}

		const parsed = new URL(sourceRepository);
		if (parsed.hostname !== "github.com") return null;

		const segments = parsed.pathname.split("/").filter(Boolean).slice(0, 2);
		if (segments.length < 2) return null;

		return {
			owner: segments[0],
			repo: stripGitSuffix(segments[1]),
		};
	} catch {
		return null;
	}
}

export function buildGithubReleaseAssetUrl(
	sourceRepository: string,
	releaseTag: string,
	assetName: string,
): string {
	const coordinates = resolveGithubRepoCoordinates(sourceRepository);
	if (!coordinates) {
		throw new Error(
			`Unable to resolve GitHub repository coordinates from sourceRepository: ${sourceRepository}`,
		);
	}

	return `https://github.com/${coordinates.owner}/${coordinates.repo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
}

export function normalizeRuntimeDescriptorRevocationList(
	payload: unknown,
	source: string,
): RuntimeDescriptorRevocationList {
	const list = payload as RuntimeDescriptorRevocationList;
	if (list?.schemaVersion !== 1) {
		throw new Error(
			`Runtime descriptor revocation list schemaVersion must be 1 (${source}).`,
		);
	}

	if (!Array.isArray(list.revokedDescriptorHashes)) {
		throw new Error(
			`Runtime descriptor revocation list revokedDescriptorHashes must be an array (${source}).`,
		);
	}

	const normalizedHashes = list.revokedDescriptorHashes
		.filter((hash) => typeof hash === "string" && hash.trim().length > 0)
		.map((hash) => hash.trim());

	return {
		schemaVersion: 1,
		updatedAt: list.updatedAt,
		version: list.version,
		revokedDescriptorHashes: normalizedHashes,
		notes: list.notes,
	};
}

export async function fetchRuntimeDescriptorRevocationList(
	input: string | RuntimeDescriptorRevocationListReference,
	options: FetchRuntimeDescriptorRevocationOptions = {},
): Promise<RuntimeDescriptorRevocationList> {
	const url = typeof input === "string" ? input : input.url;
	const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
	const now = Date.now();
	const cached = revocationListCache.get(url);
	if (cached && cached.expiresAt > now) {
		return cached.list;
	}

	const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
	try {
		const response = await fetchFn(url);
		if (!response.ok) {
			throw new Error(`failed to fetch (${response.statusText})`);
		}

		const payload = await response.json();
		const normalized = normalizeRuntimeDescriptorRevocationList(payload, url);
		revocationListCache.set(url, {
			expiresAt: now + Math.max(0, cacheTtlMs),
			list: normalized,
		});
		return normalized;
	} catch (error: any) {
		if (options.allowStaleOnError && cached) {
			return cached.list;
		}
		throw new Error(
			`Failed to resolve runtime descriptor revocation list ${url}: ${error?.message ?? error}`,
		);
	}
}

export function isDescriptorHashRevoked(
	descriptorHash: string,
	revocationList: RuntimeDescriptorRevocationList,
): boolean {
	return revocationList.revokedDescriptorHashes.includes(descriptorHash);
}
