import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
    CONFIG_NODE_KIND,
    CONFIG_NODE_REDACTION,
    CONFIG_NODE_SCHEMA,
    configFromNode,
    createConfigNode,
    loadConfigNode,
    redactConfigForNode,
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
