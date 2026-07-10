import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DEFAULT_ENV_PREFIX,
	ENV_PREFIX_SELECTOR_KEY,
	defaultRefarmConfigPath,
	envPrefixFromBrand,
	findRefarmConfigPath,
	findRefarmRoot,
	loadConfig,
	loadConfigAsync,
	resolveEnvPrefix,
} from "./index.js";

describe("@refarm.dev/config Deterministic Tests", () => {
	const root = findRefarmRoot();

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("should load basic config and handle brand if provided via env", () => {
		vi.stubEnv("REFARM_SITE_URL", "https://aretw0.github.io/refarm");
		const config = loadConfig(root);
		expect(config.brand).toBeDefined();
		// Site URL should be interpolated or set directly: https://aretw0.github.io/refarm
		expect(config.brand.urls?.site).toContain("github.io");
	});

	it("should prioritize environment overrides", () => {
		vi.stubEnv("REFARM_SITE_URL", "https://aretw0.github.io/refarm");
		vi.stubEnv("REFARM_GIT_HOST", "gitlab");
		const configOverride = loadConfig(root);
		expect(configOverride.infrastructure.gitHost).toBe("gitlab");
		// Note: in EnvSource, both REFARM_SITE_URL and REFARM_GIT_HOST are processed.
		expect(configOverride.brand.urls?.site).toContain("github.io");
	});

	it("should handle async loading and remote merging", async () => {
		// Mock fetch for remote source
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ brand: { motto: "Sovereignty by Design", name: "Refarm" } }),
		});
		global.fetch = mockFetch;

		vi.stubEnv("REFARM_EPHEMERAL_SOURCE", "https://sovereign.graph/refarm");
		const remoteConfig = await loadConfigAsync(root);

		expect(remoteConfig.brand.motto).toBe("Sovereignty by Design");
		expect(mockFetch).toHaveBeenCalledWith(
			"https://sovereign.graph/refarm",
			expect.objectContaining({
				headers: expect.objectContaining({
					Accept: "application/json",
				}),
			}),
		);
	});

	it("prefers .refarm/config.json over legacy root config", () => {
		const root = mkdtempSync(join(tmpdir(), "refarm-config-paths-"));
		try {
			mkdirSync(join(root, ".refarm"), { recursive: true });
			writeFileSync(
				join(root, "refarm.config.json"),
				JSON.stringify({ brand: { slug: "legacy" } }),
			);
			writeFileSync(
				defaultRefarmConfigPath(root),
				JSON.stringify({ brand: { slug: "canonical" } }),
			);

			expect(findRefarmConfigPath(root)).toBe(defaultRefarmConfigPath(root));
			expect(loadConfig(root).brand.slug).toBe("canonical");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("merges legacy root config with canonical project-local config", () => {
		const root = mkdtempSync(join(tmpdir(), "refarm-config-merge-"));
		try {
			mkdirSync(join(root, ".refarm"), { recursive: true });
			writeFileSync(
				join(root, "refarm.config.json"),
				JSON.stringify({
					brand: {
						slug: "legacy",
						scopes: { dev: "@legacy" },
					},
					health: {
						workspaceRoots: ["packages"],
						ignoredGitVisibilityPatterns: ["legacy.js"],
					},
					workspaceNamespaces: {
						".project": {
							owner: "project",
							persistence: "versioned",
							access: "readWrite",
						},
					},
				}),
			);
			writeFileSync(
				defaultRefarmConfigPath(root),
				JSON.stringify({
					brand: { slug: "canonical" },
					health: {
						ignoredGitVisibilityPatterns: ["canonical.js"],
					},
				}),
			);

			expect(loadConfig(root)).toMatchObject({
				brand: {
					slug: "canonical",
					scopes: { dev: "@legacy" },
				},
				health: {
					workspaceRoots: ["packages"],
					ignoredGitVisibilityPatterns: ["canonical.js"],
				},
				workspaceNamespaces: {
					".project": {
						owner: "project",
						persistence: "versioned",
						access: "readWrite",
					},
				},
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("keeps legacy root config readable for existing projects", () => {
		const root = mkdtempSync(join(tmpdir(), "refarm-config-legacy-"));
		try {
			const legacyConfigPath = join(root, "refarm.config.json");
			writeFileSync(legacyConfigPath, JSON.stringify({ brand: { slug: "legacy" } }));

			expect(findRefarmConfigPath(root)).toBe(legacyConfigPath);
			expect(findRefarmRoot(join(root, "nested"))).toBe(root);
			expect(loadConfig(root).brand.slug).toBe("legacy");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("env-var prefix is parameterizable (white-label seam, ADR-087 phase 4)", () => {
	const root = findRefarmRoot();

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("derives a normalized prefix from a brand name", () => {
		expect(envPrefixFromBrand("refarm")).toBe("REFARM");
		expect(envPrefixFromBrand("acme")).toBe("ACME");
		expect(envPrefixFromBrand("acme labs")).toBe("ACME_LABS");
		expect(envPrefixFromBrand("@acme.dev")).toBe("ACME_DEV");
	});

	it("resolves the prefix: explicit → neutral selector → default", () => {
		expect(resolveEnvPrefix("acme", {})).toBe("ACME");
		expect(resolveEnvPrefix(undefined, { [ENV_PREFIX_SELECTOR_KEY]: "acme" })).toBe("ACME");
		expect(resolveEnvPrefix(undefined, {})).toBe(DEFAULT_ENV_PREFIX);
		// explicit wins over the selector env
		expect(resolveEnvPrefix("beta", { [ENV_PREFIX_SELECTOR_KEY]: "acme" })).toBe("BETA");
	});

	it("reads <PREFIX>_ env vars for an explicit white-label prefix", () => {
		vi.stubEnv("ACME_SITE_URL", "https://acme.example/site");
		vi.stubEnv("ACME_GIT_HOST", "gitlab");
		vi.stubEnv("ACME_SCOPE_DEV", "@acme-dev");
		vi.stubEnv("ACME_PROVIDER_GITHUB_CLIENT_ID", "acme-client-123");
		// A REFARM_-prefixed var must be IGNORED when the prefix is ACME.
		vi.stubEnv("REFARM_SITE_URL", "https://refarm.example/should-not-leak");

		const config = loadConfig(root, { envPrefix: "acme" });
		expect(config.brand.urls?.site).toBe("https://acme.example/site");
		expect(config.infrastructure.gitHost).toBe("gitlab");
		expect(config.brand.scopes?.dev).toBe("@acme-dev");
		expect(config.providers?.github?.clientId).toBe("acme-client-123");
	});

	it("resolves the prefix from the neutral selector env when no explicit prefix", () => {
		vi.stubEnv(ENV_PREFIX_SELECTOR_KEY, "acme");
		vi.stubEnv("ACME_GIT_HOST", "gitlab");
		const config = loadConfig(root);
		expect(config.infrastructure.gitHost).toBe("gitlab");
	});

	it("defaults to REFARM_ so existing callers keep working", () => {
		vi.stubEnv("REFARM_GIT_HOST", "gitlab");
		const config = loadConfig(root);
		expect(config.infrastructure.gitHost).toBe("gitlab");
	});
});
