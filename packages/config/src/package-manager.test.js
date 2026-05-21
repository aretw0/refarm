import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    createPackageScriptCommand,
    detectPackageManager,
    packageInstallCommand,
    packageScriptCommand,
} from "./package-manager.js";

describe("package manager config", () => {
    it("honors REFARM_PACKAGE_MANAGER as an operator override", () => {
        expect(detectPackageManager({ env: { REFARM_PACKAGE_MANAGER: " bun " } })).toBe("bun");
        expect(packageScriptCommand("test", { env: { REFARM_PACKAGE_MANAGER: " bun " } })).toMatchObject({
            packageManager: "bun",
            command: "bun run test",
        });
    });

    it("detects packageManager while walking up from a workspace", () => {
        const root = mkdtempSync(join(tmpdir(), "refarm-config-pm-"));
        const app = join(root, "apps", "dev");
        mkdirSync(app, { recursive: true });
        writeFileSync(join(root, "package.json"), JSON.stringify({ packageManager: " pnpm@11.1.2 " }));
        writeFileSync(join(app, "package.json"), JSON.stringify({ name: "dev" }));

        try {
            expect(detectPackageManager({ cwd: app, env: {} })).toBe("pnpm");
            expect(packageInstallCommand({ cwd: app, env: {} })).toMatchObject({
                command: "pnpm install",
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it("formats spawn-safe script commands for application launchers", () => {
        expect(
            createPackageScriptCommand({
                cwd: "apps/dev",
                script: "preview",
                env: { REFARM_PACKAGE_MANAGER: "bun" },
            }),
        ).toEqual({
            packageManager: "bun",
            command: "bun",
            args: ["--cwd", "apps/dev", "run", "preview"],
            display: "bun --cwd apps/dev run preview",
        });
    });

    it("falls back to npm when no supported package manager is configured", () => {
        expect(detectPackageManager({ cwd: tmpdir(), env: {} })).toBe("npm");
    });
});
