import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectAndStore } from "./collect.js";
import { SiloCore } from "./index.js";

function tmpCore() {
    const dir = mkdtempSync(path.join(os.tmpdir(), "silo-"));
    return new SiloCore({ storagePath: path.join(dir, "identity.json") });
}

describe("silo collectAndStore", () => {
    it("collects via the provider and stores under its namespace", async () => {
        const core = tmpCore();
        const provider = {
            id: "telegram",
            label: "Telegram",
            namespace: "channel",
            collect: async () => "tok-123",
        };

        const result = await collectAndStore(provider, { tryOpenUrl() {} }, core);

        expect(result).toEqual({
            id: "telegram",
            namespace: "channel",
            stored: true,
        });
        expect(await core.loadSecret("channel", "telegram")).toBe("tok-123");
    });

    it("routes different providers to different namespaces", async () => {
        const core = tmpCore();

        await collectAndStore(
            { id: "k", label: "M", namespace: "model", collect: async () => "m" },
            { tryOpenUrl() {} },
            core,
        );
        await collectAndStore(
            { id: "k", label: "R", namespace: "runtime", collect: async () => "r" },
            { tryOpenUrl() {} },
            core,
        );

        expect(await core.loadSecret("model", "k")).toBe("m");
        expect(await core.loadSecret("runtime", "k")).toBe("r");
    });
});
