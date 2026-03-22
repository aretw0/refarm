import { afterEach, describe, expect, it, vi } from "vitest";
import { findRefarmRoot, loadConfig, loadConfigAsync } from "./index.js";

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
});

