import { describe, expect, it, vi } from "vitest";
import { WindmillEngine } from "./index.js";

function makeEngine(config = {}, options = {}) {
    return new WindmillEngine(
        {
            brand: {
                slug: "refarm-test",
                owner: "refarm-dev",
                urls: { repository: "https://github.com/refarm-dev/refarm-test.git" },
            },
            infrastructure: {},
            distribution: {},
            ...config,
        },
        options,
    );
}

describe("WindmillEngine", () => {
    it("pulls repository and DNS state from configured providers", async () => {
        const engine = makeEngine({
            infrastructure: {
                gitHost: "github",
                cloudflare: { zoneId: "zone-1" },
            },
        });
        engine.github = { listRepos: vi.fn().mockResolvedValue(["refarm-test"]) };
        engine.cloudflare = {
            listRecords: vi.fn().mockResolvedValue([{ name: "www", type: "CNAME" }]),
        };

        await expect(engine.pull()).resolves.toEqual({
            github: { exists: true, visibility: "unknown" },
            cloudflare: { records: [{ name: "www", type: "CNAME" }] },
        });
        expect(engine.github.listRepos).toHaveBeenCalledOnce();
        expect(engine.cloudflare.listRecords).toHaveBeenCalledOnce();
    });

    it("syncs backup mirroring and DNS records with dry-run propagated", async () => {
        const engine = makeEngine(
            {
                infrastructure: {
                    gitHost: "github",
                    backup: { repository: "https://backup.example/refarm.git" },
                    cloudflare: {
                        zoneId: "zone-1",
                        dns: [{ name: "www", type: "CNAME", content: "pages.dev" }],
                    },
                },
            },
            { dryRun: true },
        );
        engine.github = {
            listRepos: vi.fn().mockResolvedValue([]),
            mirrorRepo: vi.fn().mockResolvedValue({ status: "dry-run" }),
        };
        engine.cloudflare = {
            listRecords: vi.fn().mockResolvedValue([]),
            syncRecords: vi.fn().mockResolvedValue({ status: "dry-run", changes: [] }),
        };

        await expect(engine.sync()).resolves.toEqual({
            github: { status: "dry-run" },
            cloudflare: { status: "dry-run", changes: [] },
            status: "completed",
        });
        expect(engine.github.mirrorRepo).toHaveBeenCalledWith(
            "refarm-test",
            "https://backup.example/refarm.git",
            { dryRun: true },
        );
        expect(engine.cloudflare.syncRecords).toHaveBeenCalledWith(
            [{ name: "www", type: "CNAME", content: "pages.dev" }],
            { dryRun: true },
        );
    });

    it("deploys all configured targets and reports partial failure", async () => {
        const engine = makeEngine({
            distribution: {
                targets: [
                    { type: "cloudflare", site: "site-a", dist: "dist/site-a" },
                    { type: "github", repo: "repo-a", dist: "dist/repo-a" },
                    { type: "unknown" },
                ],
            },
        });
        engine.cloudflare = {
            deployPages: vi.fn().mockResolvedValue({ status: "success", url: "https://site-a.pages.dev" }),
        };
        engine.github = {
            deployPages: vi.fn().mockResolvedValue({ status: "success", url: "https://refarm-dev.github.io/repo-a" }),
        };

        const result = await engine.deploy("all");

        expect(result.status).toBe("partial_failure");
        expect(result.results).toEqual([
            { target: "cloudflare", status: "success", url: "https://site-a.pages.dev" },
            { target: "github", status: "success", url: "https://refarm-dev.github.io/repo-a" },
            {
                target: "unknown",
                status: "error",
                message: "Unsupported deployment target: unknown",
            },
        ]);
    });

    it("returns an explicit error when no distribution targets are configured", async () => {
        const engine = makeEngine();

        await expect(engine.deploy("all")).resolves.toEqual({
            status: "error",
            message: "No distribution targets defined in .refarm/config.json",
        });
    });
});
