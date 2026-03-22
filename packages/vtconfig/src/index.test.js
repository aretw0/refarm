import { describe, expect, it, vi } from "vitest";
import { getAliases, baseConfig } from "./index.js";
import path from "node:path";
import fs from "node:fs";

vi.mock("node:fs", () => ({
    default: {
        existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
}));

describe("@refarm.dev/vtconfig Deterministic Verifications", () => {
    it("should resolve src/index.ts for TS-Strict packages", () => {
        vi.mocked(fs.existsSync).mockImplementation((p) => p.toString().includes("index.ts"));
        
        const aliases = getAliases("/root");
        expect(aliases["@refarm.dev/tractor"]).toContain("src/index.ts");
    });

    it("should resolve src/index.js for JS-Atomic packages", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        
        const aliases = getAliases("/root");
        expect(aliases["@refarm.dev/config"]).toContain("src/index.js");
    });

    it("should resolve dist/index.js when VITEST_USE_DIST is true", () => {
        vi.stubEnv("VITEST_USE_DIST", "true");
        const aliases = getAliases("/root");
        expect(aliases["@refarm.dev/tractor"]).toContain("dist/index.js");
        vi.unstubAllEnvs();
    });

    it("should have globally enabled globals", () => {
        expect(baseConfig.test.globals).toBe(true);
    });

    it("should default to node environment for performance", () => {
        expect(baseConfig.test.environment).toBe("node");
    });
});
