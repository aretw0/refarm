import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    defaultRefarmConfigPath,
    findRefarmConfigPath,
    findRefarmRoot,
    loadConfig,
    loadConfigAsync,
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
            json: async () => ({ brand: { motto: "Sovereignty by Design", name: "Refarm" } })
        });
        global.fetch = mockFetch;

        vi.stubEnv("REFARM_EPHEMERAL_SOURCE", "https://sovereign.graph/refarm");
        const remoteConfig = await loadConfigAsync(root);
        
        expect(remoteConfig.brand.motto).toBe("Sovereignty by Design");
        expect(mockFetch).toHaveBeenCalledWith(
          "https://sovereign.graph/refarm", 
          expect.objectContaining({
            headers: expect.objectContaining({
                "Accept": "application/json"
            })
          })
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

    it("keeps legacy root config readable for existing projects", () => {
        const root = mkdtempSync(join(tmpdir(), "refarm-config-legacy-"));
        try {
            const legacyConfigPath = join(root, "refarm.config.json");
            writeFileSync(
                legacyConfigPath,
                JSON.stringify({ brand: { slug: "legacy" } }),
            );

            expect(findRefarmConfigPath(root)).toBe(legacyConfigPath);
            expect(findRefarmRoot(join(root, "nested"))).toBe(root);
            expect(loadConfig(root).brand.slug).toBe("legacy");
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
