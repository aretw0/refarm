import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
    CONFIG_NODE_DEVICE_LOCAL_KEYS,
    CONFIG_NODE_KIND,
    CONFIG_NODE_REDACTION,
    CONFIG_NODE_SCHEMA,
    configFromNode,
    createConfigNode,
    loadConfigNode,
    redactConfigForNode,
    toPortableConfig,
} from "./config-node.js";
import { defaultRefarmConfigPath } from "./index.js";

describe("config node", () => {
    it("creates a deterministic redacted config node", () => {
        const first = createConfigNode({
            brand: { slug: "refarm" },
            providers: {
                github: {
                    accessToken: "secret-token",
                    scopes: "repo",
                },
            },
        });
        const second = createConfigNode({
            providers: {
                github: {
                    scopes: "repo",
                    accessToken: "different-secret",
                },
            },
            brand: { slug: "refarm" },
        });

        expect(first.schema).toBe(CONFIG_NODE_SCHEMA);
        expect(first.kind).toBe(CONFIG_NODE_KIND);
        expect(first.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(first.evidence.configDigest).toMatch(/^[a-f0-9]{64}$/);
        expect(first.evidence.redactedPaths).toEqual(["providers.github.accessToken"]);
        expect(first.data.providers.github.accessToken).toBe(CONFIG_NODE_REDACTION);
        expect(first.revision).toBe(second.revision);
        expect(first.data).toEqual(second.data);
    });

    it("round-trips node data without accepting another node kind", () => {
        const node = createConfigNode({ brand: { slug: "refarm" } });

        expect(configFromNode(node)).toEqual({ brand: { slug: "refarm" } });
        expect(() => configFromNode({ ...node, kind: "other" })).toThrow(/config node/);
    });

    it("loads a workspace config as a graph-portable node", () => {
        const root = mkdtempSync(join(tmpdir(), "refarm-config-node-"));
        try {
            mkdirSync(join(root, ".refarm"), { recursive: true });
            writeFileSync(
                defaultRefarmConfigPath(root),
                JSON.stringify({
                    brand: { slug: "refarm" },
                    providers: { github: { clientSecret: "secret" } },
                }),
            );

            const node = loadConfigNode(root);

            expect(node.evidence.source).toBe("loadConfig");
            expect(node.data.brand.slug).toBe("refarm");
            expect(node.data.providers.github.clientSecret).toBe(CONFIG_NODE_REDACTION);
            expect(node.evidence.redactedPaths).toEqual(["providers.github.clientSecret"]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("allows host-defined redaction policy", () => {
        const { value, redactions } = redactConfigForNode(
            { public: "ok", signingKeyPath: "/tmp/key" },
            { redactionKeyPatterns: ["keyPath"] },
        );

        expect(value).toEqual({ public: "ok", signingKeyPath: CONFIG_NODE_REDACTION });
        expect(redactions).toEqual(["signingKeyPath"]);
    });
});

describe("config node — device-global vs device-local boundary", () => {
    // Force the pain now: the machine/user split is a red assertion before any second
    // device exists. Canonical rule (VS Code `machine` scope): paths, executables,
    // per-host launch/exec, and this device's endpoint never replicate.

    it("strips runtime.sidecarUrl (this host's loopback endpoint) from the node", () => {
        const node = createConfigNode({
            model: "gpt-4",
            runtime: { sidecarUrl: "http://127.0.0.1:42001" },
        });
        expect(node.data.model).toBe("gpt-4");
        expect(node.data.runtime).toBeUndefined();
        expect(node.evidence.deviceLocalPaths).toContain("runtime.sidecarUrl");
    });

    it("strips autostart (per-host launch role — a build box must not force a laptop)", () => {
        const node = createConfigNode({ autostart: "always", model: "gpt-4" });
        expect(node.data.autostart).toBeUndefined();
        expect(node.data.model).toBe("gpt-4");
    });

    it("strips tractor.engine (replicating `rust` to a host with no binary throws at launch)", () => {
        const node = createConfigNode({ tractor: { engine: "rust" } });
        expect(node.data.tractor).toBeUndefined();
    });

    it("strips absolute workspace paths wherever they nest (OS-specific, not portable)", () => {
        const node = createConfigNode({
            workspaces: {
                lab: {
                    path: "../agents-lab",
                    bridges: [{ path: "/mnt/c/Users/aretw/x", hostPath: "C:\\Users\\aretw\\x" }],
                },
            },
        });
        // The whole `path`/`hostPath` leaves are dropped; the workspace container stays.
        expect(node.data.workspaces.lab.path).toBeUndefined();
        expect(node.data.workspaces.lab.bridges[0].path).toBeUndefined();
        expect(node.data.workspaces.lab.bridges[0].hostPath).toBeUndefined();
    });

    it("REMOVES device-local fields rather than placeholder'ing them (they have no portable value)", () => {
        const node = createConfigNode({ runtime: { sidecarUrl: "http://127.0.0.1:42001" } });
        // Not "<redacted>" — the key is gone entirely.
        expect(JSON.stringify(node.data)).not.toContain(CONFIG_NODE_REDACTION);
        expect(node.data.runtime).toBeUndefined();
    });

    it("converges: two devices differing ONLY in device-local fields hash identically", () => {
        const deviceA = createConfigNode({
            model: "gpt-4",
            approvedPermissions: { vault: ["fs:read"] },
            runtime: { sidecarUrl: "http://127.0.0.1:42001" },
            tractor: { engine: "rust" },
            autostart: "always",
        });
        const deviceB = createConfigNode({
            model: "gpt-4",
            approvedPermissions: { vault: ["fs:read"] },
            runtime: { sidecarUrl: "http://127.0.0.1:47777" },
            tractor: { engine: "ts" },
            autostart: "never",
        });
        // Identical device-GLOBAL config → identical revision, despite different endpoints/engine.
        expect(deviceA.revision).toBe(deviceB.revision);
    });

    it("TWO-LAYER MODEL: the capability GRANT converges, the host ALLOWLIST does not", () => {
        // approvedPermissions is the user's portable intent → GLOBAL, rides the node.
        // MODEL_SHELL_ALLOWLIST is a per-host machine fact → LOCAL, must never ride it.
        const deviceA = createConfigNode({
            approvedPermissions: { vault: ["shell:spawn"] },
            MODEL_SHELL_ALLOWLIST: "cargo,rustc,wasm-tools",
        });
        // The grant (intent) is present and converges — refarm syncs what other products won't.
        expect(deviceA.data.approvedPermissions).toEqual({ vault: ["shell:spawn"] });
        // The allowlist (machine capability) never enters the node — a peer without the
        // toolchain must not inherit an allowlist for binaries it lacks.
        expect(deviceA.data.MODEL_SHELL_ALLOWLIST).toBeUndefined();
    });

    it("anti-pattern net: NO device-local key ever survives in the node payload", () => {
        // Syncthing's rule: machine identity/paths must never replicate. Assert every
        // device-local key is absent from the produced node.data, at any depth.
        const node = createConfigNode({
            model: "gpt-4",
            runtime: { sidecarUrl: "http://127.0.0.1:42001" },
            tractor: { engine: "rust" },
            autostart: "always",
            MODEL_FS_ROOT: "/workspaces/refarm",
            MODEL_SHELL_ALLOWLIST: "ls,cat",
            peerId: "424242",
            nested: { path: "/abs", hostPath: "C:\\x" },
        });
        const serialized = JSON.stringify(node.data).toLowerCase();
        for (const key of CONFIG_NODE_DEVICE_LOCAL_KEYS) {
            expect(serialized).not.toContain(`"${key.toLowerCase()}":`);
        }
        expect(node.data.model).toBe("gpt-4");
    });

    it("toPortableConfig drops device-local keys but keeps secrets for downstream redaction", () => {
        const portable = toPortableConfig({
            model: "gpt-4",
            runtime: { sidecarUrl: "http://127.0.0.1:42001" },
            providers: { github: { accessToken: "secret" } },
        });
        expect(portable.runtime).toBeUndefined();
        expect(portable.model).toBe("gpt-4");
        // Secret still present here — createConfigNode redacts it later, not toPortableConfig.
        expect(portable.providers.github.accessToken).toBe("secret");
    });
});
