import { describe, expect, it } from "vitest";
import {
    declaredWorkspaceNamespaceFromConfig,
    declaredWorkspaceNamespacesFromConfig,
    parseWorkspaceNamespaceAccess,
    parseWorkspaceNamespacePersistence,
} from "./workspace-namespaces-config.js";

describe("workspace namespace declarations", () => {
    it("normalizes declared root namespaces as project intent", () => {
        const config = {
            workspaceNamespaces: {
                ".project": {
                    owner: "pi-project-workflows",
                    purpose: "Durable project planning handoff.",
                    persistence: "versioned",
                    access: "readWrite",
                },
                ".pi-lens": {
                    purpose: "Local analysis cache.",
                    persistence: "ignored",
                },
            },
        };

        expect(declaredWorkspaceNamespacesFromConfig(config, { baseDir: "/workspaces/refarm" })).toEqual([
            {
                id: ".pi-lens",
                path: ".pi-lens",
                absolutePath: "/workspaces/refarm/.pi-lens",
                owner: "workspace",
                purpose: "Local analysis cache.",
                persistence: "ignored",
                access: "readWrite",
            },
            {
                id: ".project",
                path: ".project",
                absolutePath: "/workspaces/refarm/.project",
                owner: "pi-project-workflows",
                purpose: "Durable project planning handoff.",
                persistence: "versioned",
                access: "readWrite",
            },
        ]);
    });

    it("supports explicit path values and conservative defaults", () => {
        expect(declaredWorkspaceNamespaceFromConfig({
            workspaceNamespaces: {
                project: {
                    path: ".project",
                },
            },
        }, ".project", { baseDir: "/workspaces/refarm" })).toMatchObject({
            id: "project",
            path: ".project",
            absolutePath: "/workspaces/refarm/.project",
            owner: "workspace",
            purpose: "Declared workspace namespace.",
            persistence: "ephemeral",
            access: "readWrite",
        });
    });

    it("ignores malformed namespace declarations", () => {
        expect(declaredWorkspaceNamespacesFromConfig({
            workspaceNamespaces: {
                ok: { path: ".ok" },
                absolute: { path: "/tmp/nope" },
                parent: { path: "../nope" },
                empty: { path: "" },
                nope: null,
            },
        })).toEqual([
            expect.objectContaining({ id: "ok", path: ".ok" }),
        ]);
    });

    it("parses known enum values", () => {
        expect(parseWorkspaceNamespacePersistence("versioned")).toBe("versioned");
        expect(parseWorkspaceNamespacePersistence("permanent")).toBeNull();
        expect(parseWorkspaceNamespaceAccess("generated")).toBe("generated");
        expect(parseWorkspaceNamespaceAccess("admin")).toBeNull();
    });
});
