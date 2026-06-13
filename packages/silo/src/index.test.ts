import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SiloCore } from "./index.js";

vi.mock("@refarm.dev/heartwood", () => ({
    default: {
        generateKeypair: async () => ({
            secretKey: new Uint8Array(32),
            publicKey: new Uint8Array(32)
        })
    }
}));

describe("@refarm.dev/silo Smoke Tests", () => {
    it("should initialize SiloCore and resolve tokens", async () => {
        const silo = new SiloCore({
            tokens: { githubToken: "test-token" }
        });
        const tokens = await silo.resolve();
        expect(tokens.get("REFARM_GITHUB_TOKEN")).toBe("test-token");
    });

    it("should provision tokens as object by default", async () => {
        const silo = new SiloCore({
            tokens: { githubToken: "test-token" }
        });
        const provisioned = await silo.provision();
        expect(provisioned.REFARM_GITHUB_TOKEN).toBe("test-token");
    });

    it("should persist long JWT-shaped GitHub tokens without parsing or truncation", async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), "refarm-silo-"));
        const token = `ghs_${"a".repeat(180)}.${"b".repeat(180)}.${"c".repeat(180)}`;
        const silo = new SiloCore({});
        silo.storagePath = path.join(tempDir, "identity.json");

        try {
            await silo.saveTokens({ githubToken: token });
            const stored = await silo.loadTokens();
            const resolved = await silo.resolve();

            expect(stored.githubToken).toBe(token);
            expect(resolved.get("REFARM_GITHUB_TOKEN")).toBe(token);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("should bootstrap identity using KeyManager", async () => {
        const silo = new SiloCore({});
        const res = await silo.bootstrapIdentity();
        expect(res.status).toBe("ready");
        expect(res.publicKey).toBeDefined();
    });
});
