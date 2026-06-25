import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SiloCore } from "./index.js";

function tmpCore() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "silo-"));
    return new SiloCore({ storagePath: path.join(dir, "identity.json") });
}

describe("SiloCore namespaced secrets", () => {
    it("saves and loads a secret under a namespace", async () => {
        const core = tmpCore();

        await core.saveSecret("channel", "telegram", "tok-123");

        expect(await core.loadSecret("channel", "telegram")).toBe("tok-123");
    });

    it("keeps namespaces separate and does not touch tokens", async () => {
        const core = tmpCore();

        await core.saveTokens({ githubToken: "g" });
        await core.saveSecret("model", "openai", "m");
        await core.saveSecret("runtime", "openai", "r");

        expect(await core.loadSecret("model", "openai")).toBe("m");
        expect(await core.loadSecret("runtime", "openai")).toBe("r");
        expect((await core.loadTokens()).githubToken).toBe("g");
    });

    it("returns undefined for a missing secret", async () => {
        expect(await tmpCore().loadSecret("channel", "nope")).toBeUndefined();
    });
});
