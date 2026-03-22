import { describe, expect, it, vi } from "vitest";
import { SiloCore } from "./index.js";

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

    it("should bootstrap identity using KeyManager", async () => {
        // Mock heartwood to avoid WASM loading in simple smoke test
        vi.mock("@refarm.dev/heartwood", () => ({
            default: {
                generateKeypair: async () => ({
                    secretKey: new Uint8Array(32),
                    publicKey: new Uint8Array(32)
                })
            }
        }));

        const silo = new SiloCore({});
        const res = await silo.bootstrapIdentity();
        expect(res.status).toBe("ready");
        expect(res.publicKey).toBeDefined();
    });
});
