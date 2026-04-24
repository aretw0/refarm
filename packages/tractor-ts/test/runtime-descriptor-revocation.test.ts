import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildGithubReleaseAssetUrl,
	clearRuntimeDescriptorRevocationListCache,
	fetchRuntimeDescriptorRevocationList,
	normalizeRuntimeDescriptorRevocationList,
	resolveGithubRepoCoordinates,
} from "../src/lib/runtime-descriptor-revocation";

describe("runtime-descriptor-revocation", () => {
	beforeEach(() => {
		clearRuntimeDescriptorRevocationListCache();
	});

	it("resolves GitHub repository coordinates for https and SSH URLs", () => {
		expect(
			resolveGithubRepoCoordinates("https://github.com/refarm-dev/refarm"),
		).toEqual({ owner: "refarm-dev", repo: "refarm" });
		expect(
			resolveGithubRepoCoordinates("https://github.com/refarm-dev/refarm.git"),
		).toEqual({ owner: "refarm-dev", repo: "refarm" });
		expect(
			resolveGithubRepoCoordinates("git@github.com:refarm-dev/refarm.git"),
		).toEqual({ owner: "refarm-dev", repo: "refarm" });
		expect(
			resolveGithubRepoCoordinates("https://gitlab.com/refarm-dev/refarm"),
		).toBeNull();
	});

	it("builds encoded release asset URL", () => {
		expect(
			buildGithubReleaseAssetUrl(
				"https://github.com/refarm-dev/refarm",
				"@acme/plugin@1.2.3",
				"runtime-descriptor-revocations.json",
			),
		).toBe(
			"https://github.com/refarm-dev/refarm/releases/download/%40acme%2Fplugin%401.2.3/runtime-descriptor-revocations.json",
		);
	});

	it("normalizes payload and trims revoked hashes", () => {
		const normalized = normalizeRuntimeDescriptorRevocationList(
			{
				schemaVersion: 1,
				revokedDescriptorHashes: ["  sha256-a  ", "", "sha256-b"],
				notes: "ok",
			},
			"test-source",
		);

		expect(normalized.revokedDescriptorHashes).toEqual([
			"sha256-a",
			"sha256-b",
		]);
		expect(normalized.notes).toBe("ok");
	});

	it("uses fresh cache entry when TTL is valid", async () => {
		const fetchFn = vi.fn().mockResolvedValue({
			ok: true,
			statusText: "OK",
			json: async () => ({
				schemaVersion: 1,
				revokedDescriptorHashes: ["sha256-x"],
			}),
		});

		const first = await fetchRuntimeDescriptorRevocationList(
			"https://example.test/revocations.json",
			{ fetchFn, cacheTtlMs: 60_000 },
		);
		const second = await fetchRuntimeDescriptorRevocationList(
			"https://example.test/revocations.json",
			{ fetchFn, cacheTtlMs: 60_000 },
		);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(second).toEqual(first);
	});

	it("uses stale cache on fetch failure when allowStaleOnError=true", async () => {
		const successFetch = vi.fn().mockResolvedValue({
			ok: true,
			statusText: "OK",
			json: async () => ({
				schemaVersion: 1,
				revokedDescriptorHashes: ["sha256-stale"],
			}),
		});

		await fetchRuntimeDescriptorRevocationList(
			"https://example.test/revocations.json",
			{ fetchFn: successFetch, cacheTtlMs: 0 },
		);

		const onStaleFallback = vi.fn();
		const failedFetch = vi.fn().mockResolvedValue({
			ok: false,
			statusText: "Service Unavailable",
		});

		const list = await fetchRuntimeDescriptorRevocationList(
			"https://example.test/revocations.json",
			{
				fetchFn: failedFetch,
				cacheTtlMs: 0,
				allowStaleOnError: true,
				onStaleFallback,
			},
		);

		expect(list.revokedDescriptorHashes).toEqual(["sha256-stale"]);
		expect(onStaleFallback).toHaveBeenCalledTimes(1);
		expect(onStaleFallback).toHaveBeenCalledWith(
			expect.objectContaining({
				url: "https://example.test/revocations.json",
				cacheAgeMs: expect.any(Number),
			}),
		);
	});

	it("throws when fetch fails and stale fallback is disabled", async () => {
		const failedFetch = vi.fn().mockResolvedValue({
			ok: false,
			statusText: "Service Unavailable",
		});

		await expect(
			fetchRuntimeDescriptorRevocationList(
				"https://example.test/revocations.json",
				{
					fetchFn: failedFetch,
					allowStaleOnError: false,
				},
			),
		).rejects.toThrow("Failed to resolve runtime descriptor revocation list");
	});
});
