import { mkdtempSync } from "node:fs";
import { stat } from "node:fs/promises";
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

    it("lists only secrets from the requested namespace", async () => {
        const core = tmpCore();

        await core.saveSecret("publishing", "TELEGRAM_BOT_TOKEN", "tok");
        await core.saveSecret("publishing", "TELEGRAM_CHAT_ID", "chat");
        await core.saveSecret("model", "OPENAI_API_KEY", "sk");

        expect(await core.listSecrets("publishing")).toEqual({
            TELEGRAM_BOT_TOKEN: "tok",
            TELEGRAM_CHAT_ID: "chat",
        });
        expect(await core.listSecrets("model")).toEqual({
            OPENAI_API_KEY: "sk",
        });
        expect(await core.listSecrets("missing")).toEqual({});
    });

    it("removes one namespaced secret without deleting siblings or other namespaces", async () => {
        const core = tmpCore();

        await core.saveSecret("publishing", "TELEGRAM_BOT_TOKEN", "tok");
        await core.saveSecret("publishing", "TELEGRAM_CHAT_ID", "chat");
        await core.saveSecret("model", "OPENAI_API_KEY", "sk");

        await expect(core.removeSecret("publishing", "TELEGRAM_BOT_TOKEN")).resolves.toMatchObject({
            removed: true,
            namespace: "publishing",
            id: "TELEGRAM_BOT_TOKEN",
        });

        expect(await core.listSecrets("publishing")).toEqual({
            TELEGRAM_CHAT_ID: "chat",
        });
        expect(await core.listSecrets("model")).toEqual({
            OPENAI_API_KEY: "sk",
        });
        await expect(core.removeSecret("publishing", "missing")).resolves.toMatchObject({
            removed: false,
        });
    });

    it("writes storage with owner-only modes on POSIX", async () => {
        const core = tmpCore();
        await core.saveSecret("publishing", "TELEGRAM_BOT_TOKEN", "tok");

        if (process.platform === "win32") {
            expect(await core.loadSecret("publishing", "TELEGRAM_BOT_TOKEN")).toBe("tok");
            return;
        }

        const dirMode = (await stat(path.dirname(core.storagePath))).mode & 0o777;
        const fileMode = (await stat(core.storagePath)).mode & 0o777;

        expect(dirMode).toBe(0o700);
        expect(fileMode).toBe(0o600);
    });
});
