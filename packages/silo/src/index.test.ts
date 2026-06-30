import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveSiloHome, SiloCore } from "./index.js";

const heartwoodImport = vi.hoisted(() => ({ count: 0 }));

vi.mock("@refarm.dev/heartwood", () => ({
    ...(() => {
        heartwoodImport.count += 1;
        return {};
    })(),
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
        expect(tokens.get("GITHUB_TOKEN")).toBe("test-token");
    });

    it("should provision tokens as object by default", async () => {
        const silo = new SiloCore({
            tokens: { githubToken: "test-token" }
        });
        const provisioned = await silo.provision();
        expect(provisioned.GITHUB_TOKEN).toBe("test-token");
    });

    it("respects SILO_HOME for identity storage", async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), "silo-home-"));
        const originalSiloHome = process.env.SILO_HOME;
        process.env.SILO_HOME = tempDir;

        try {
            const silo = new SiloCore({});

            expect(resolveSiloHome()).toBe(tempDir);
            expect(silo.storagePath).toBe(path.join(tempDir, "identity.json"));
        } finally {
            if (originalSiloHome === undefined) {
                delete process.env.SILO_HOME;
            } else {
                process.env.SILO_HOME = originalSiloHome;
            }
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("falls back to REFARM_HOME for existing Refarm operators", async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), "refarm-silo-home-"));
        const originalSiloHome = process.env.SILO_HOME;
        const originalRefarmHome = process.env.REFARM_HOME;
        delete process.env.SILO_HOME;
        process.env.REFARM_HOME = tempDir;

        try {
            expect(resolveSiloHome()).toBe(tempDir);
        } finally {
            if (originalSiloHome === undefined) {
                delete process.env.SILO_HOME;
            } else {
                process.env.SILO_HOME = originalSiloHome;
            }
            if (originalRefarmHome === undefined) {
                delete process.env.REFARM_HOME;
            } else {
                process.env.REFARM_HOME = originalRefarmHome;
            }
            await rm(tempDir, { recursive: true, force: true });
        }
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
            expect(resolved.get("GITHUB_TOKEN")).toBe(token);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("does not resolve heartwood for storage-only operations", async () => {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), "refarm-silo-storage-"));
        const silo = new SiloCore({ storagePath: path.join(tempDir, "identity.json") });
        heartwoodImport.count = 0;

        try {
            await silo.saveSecret("publishing", "TELEGRAM_BOT_TOKEN", "tok");
            await expect(silo.loadSecret("publishing", "TELEGRAM_BOT_TOKEN")).resolves.toBe("tok");
            expect(heartwoodImport.count).toBe(0);
        } finally {
            await rm(tempDir, { recursive: true, force: true });
        }
    });

    it("should bootstrap identity using KeyManager", async () => {
        const silo = new SiloCore({});
        heartwoodImport.count = 0;
        const res = await silo.bootstrapIdentity();
        expect(res.status).toBe("ready");
        expect(res.publicKey).toBeDefined();
        expect(heartwoodImport.count).toBe(1);
    });
});
