import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

    it("stores namespaced secrets as protection envelopes", async () => {
        const core = tmpCore();

        await core.saveSecret("publishing", "TELEGRAM_BOT_TOKEN", "tok");

        const stored = JSON.parse(readFileSync(core.storagePath, "utf8"));
        expect(stored.schemaVersion).toBe(1);
        expect(stored.secrets.publishing.TELEGRAM_BOT_TOKEN).toEqual({
            value: "tok",
            protection: {
                scheme: "local-plaintext-v1",
                encrypted: false,
                atRest: "posix-owner-only",
                keySource: "none",
                upgradeTarget: "opaque-envelope-v1",
            },
        });
        await expect(core.loadSecret("publishing", "TELEGRAM_BOT_TOKEN")).resolves.toBe("tok");
        await expect(core.listSecrets("publishing")).resolves.toEqual({
            TELEGRAM_BOT_TOKEN: "tok",
        });
    });

    it("reads legacy plaintext secret entries through the envelope API", async () => {
        const core = tmpCore();
        writeFileSync(
            core.storagePath,
            JSON.stringify({
                secrets: {
                    publishing: {
                        TELEGRAM_BOT_TOKEN: "legacy-token",
                    },
                },
            }),
        );

        await expect(core.loadSecret("publishing", "TELEGRAM_BOT_TOKEN")).resolves.toBe("legacy-token");
        await expect(core.listSecrets("publishing")).resolves.toEqual({
            TELEGRAM_BOT_TOKEN: "legacy-token",
        });
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

    it("describes the protection plan for consumer status surfaces", () => {
        const core = tmpCore();

        expect(core.describeProtection()).toMatchObject({
            schemaVersion: 1,
            storagePath: core.storagePath,
            current: {
                scheme: "local-plaintext-v1",
                encrypted: false,
                atRest: "posix-owner-only",
                keySource: "none",
                upgradeTarget: "opaque-envelope-v1",
            },
            planned: [
                {
                    scheme: "opaque-envelope-v1",
                    encrypted: true,
                    keySource: "@refarm.dev/heartwood",
                    status: "planned",
                },
                {
                    scheme: "hardware-backed-envelope-v1",
                    encrypted: true,
                    keySource: "passkey|secure-enclave|tpm|hsm",
                    status: "planned",
                },
            ],
            identityClosure: {
                package: "@refarm.dev/heartwood",
                requiredForStorage: false,
            },
        });
    });
});

describe("SiloCore forward-safe envelope reads (ADR-077 freeze)", () => {
    function writeStore(core: SiloCore, store: unknown) {
        writeFileSync(core.storagePath, JSON.stringify(store));
    }

    it("string consumer methods stay string while disk stays an envelope", async () => {
        const core = tmpCore();
        await core.saveSecret("publishing", "TELEGRAM_BOT_TOKEN", "tok");

        // on-disk shape is an envelope object…
        const stored = JSON.parse(readFileSync(core.storagePath, "utf8"));
        expect(typeof stored.secrets.publishing.TELEGRAM_BOT_TOKEN).toBe("object");
        // …but the frozen consumer surface remains string-based.
        expect(typeof (await core.loadSecret("publishing", "TELEGRAM_BOT_TOKEN"))).toBe("string");
        const listed = await core.listSecrets("publishing");
        expect(typeof listed.TELEGRAM_BOT_TOKEN).toBe("string");
    });

    it("refuses a future encrypted envelope instead of returning ciphertext", async () => {
        const core = tmpCore();
        writeStore(core, {
            schemaVersion: 2,
            secrets: {
                publishing: {
                    TELEGRAM_BOT_TOKEN: {
                        value: "OPAQUE-CIPHERTEXT",
                        protection: {
                            scheme: "opaque-envelope-v1",
                            encrypted: true,
                            keySource: "@refarm.dev/heartwood",
                        },
                    },
                },
            },
        });

        await expect(core.loadSecret("publishing", "TELEGRAM_BOT_TOKEN")).rejects.toMatchObject({
            code: "SILO_SECRET_UNREADABLE",
            scheme: "opaque-envelope-v1",
        });
    });

    it("refuses an unknown scheme rather than guessing the value is plaintext", async () => {
        const core = tmpCore();
        writeStore(core, {
            secrets: { publishing: { X: { value: "v", protection: { scheme: "some-future-v9" } } } },
        });

        await expect(core.loadSecret("publishing", "X")).rejects.toMatchObject({
            code: "SILO_SECRET_UNREADABLE",
        });
    });

    it("omits unreadable entries from listSecrets but keeps readable siblings", async () => {
        const core = tmpCore();
        await core.saveSecret("publishing", "TELEGRAM_CHAT_ID", "chat");
        const stored = JSON.parse(readFileSync(core.storagePath, "utf8"));
        stored.secrets.publishing.TELEGRAM_BOT_TOKEN = {
            value: "CIPHER",
            protection: { scheme: "opaque-envelope-v1", encrypted: true },
        };
        writeStore(core, stored);

        await expect(core.listSecrets("publishing")).resolves.toEqual({ TELEGRAM_CHAT_ID: "chat" });
    });

    it("reads a higher store schemaVersion when the entry scheme is readable", async () => {
        const core = tmpCore();
        writeStore(core, {
            schemaVersion: 99,
            secrets: {
                publishing: {
                    TELEGRAM_CHAT_ID: {
                        value: "chat",
                        protection: { scheme: "local-plaintext-v1", encrypted: false },
                    },
                },
            },
        });

        await expect(core.loadSecret("publishing", "TELEGRAM_CHAT_ID")).resolves.toBe("chat");
    });
});
