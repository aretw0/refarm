import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SOVEREIGN_BASE_KEY,
	SOVEREIGN_DIR_SELECTOR_KEY,
	DEFAULT_ENV_PREFIX,
	declaredBase,
	ENV_PREFIX_SELECTOR_KEY,
	defaultSovereignConfigPath,
	envPrefixFromBrand,
	findSovereignConfigPath,
	findSovereignRoot,
	loadConfig,
	loadConfigAsync,
	resolveEnvPrefix,
} from "./index.js";

// The substrate has no config-dir default; the app injects it. These tests stand in
// for the app, selecting ".refarm" (the substrate must never assume a brand dir).
process.env[SOVEREIGN_DIR_SELECTOR_KEY] = ".refarm";

describe("@refarm.dev/config Deterministic Tests", () => {
	const root = findSovereignRoot();

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
				defaultSovereignConfigPath(root),
				JSON.stringify({ brand: { slug: "canonical" } }),
			);

			expect(findSovereignConfigPath(root)).toBe(defaultSovereignConfigPath(root));
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
				defaultSovereignConfigPath(root),
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

			expect(findSovereignConfigPath(root)).toBe(legacyConfigPath);
			expect(findSovereignRoot(join(root, "nested"))).toBe(root);
			expect(loadConfig(root).brand.slug).toBe("legacy");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("env-var prefix is parameterizable (white-label seam, ADR-087 phase 4)", () => {
	const root = findSovereignRoot();

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

describe("declaredBase", () => {
	// The node is TOLD where its declarations live and every reader must give the SAME
	// answer. Without this, a command executing a declared operation resolved the catalog
	// from wherever the daemon happened to be standing, while the admission check beside it
	// resolved from the operator's home — one process, two answers, and the operation was
	// admitted and then refused. This mirrors `dirs_sovereign_base` in
	// `packages/tractor/src/main.rs` step for step.

	it("SOVEREIGN_BASE wins outright, even over REFARM_HOME", () => {
		expect(
			declaredBase({ [SOVEREIGN_BASE_KEY]: "/declared", REFARM_HOME: "/other/.refarm" }),
		).toBe("/declared");
	});

	it("falls back to dirname(REFARM_HOME) when SOVEREIGN_BASE is unset", () => {
		// A container declaring REFARM_HOME=/srv/node/.refarm resolves /srv/node —
		// the same parent the Rust host resolves from the same variable.
		expect(declaredBase({ REFARM_HOME: "/srv/node/.refarm" })).toBe("/srv/node");
	});

	it("falls back to the OS home directory when neither is declared", () => {
		expect(declaredBase({})).toBe(os.homedir());
	});

	it("does not treat whitespace as a declaration, for either variable", () => {
		expect(
			declaredBase({ [SOVEREIGN_BASE_KEY]: "   ", REFARM_HOME: "/srv/node/.refarm" }),
		).toBe("/srv/node");
	});

	// Regression guard for the defect being removed: the old implementation defaulted its
	// (now-deleted) `cwd` parameter to `process.cwd()`, so a daemon started from inside a
	// project directory and an operator's shell standing in their home directory disagreed
	// about the node's base. Mocking process.cwd() — rather than asserting a fixed string —
	// is what makes this discriminate: the old code read process.cwd() lazily as a default
	// parameter at call time, so it would echo back whatever this mock returns; the fixed
	// implementation never reads process.cwd() at all, so it must return the OS home
	// regardless of what this mock says.
	it("never resolves to process.cwd(), even when the process is standing outside the home directory", () => {
		const elsewhere = "/not-the-home-directory/some/project";
		expect(elsewhere).not.toBe(os.homedir()); // sanity: the scenario must actually differ
		const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(elsewhere);
		try {
			expect(declaredBase({})).not.toBe(elsewhere);
			expect(declaredBase({})).toBe(os.homedir());
		} finally {
			cwdSpy.mockRestore();
		}
	});
});
