import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    detectPackageManager,
    packageFrozenInstallCommand,
    packageInstallCommand,
    packageScriptCommand,
} from "../src/package-manager.mjs";

describe("toolbox package manager commands", () => {
    it("honors REFARM_PACKAGE_MANAGER", () => {
        expect(detectPackageManager({ env: { REFARM_PACKAGE_MANAGER: " bun " } })).toBe("bun");
        expect(packageScriptCommand("test", { env: { REFARM_PACKAGE_MANAGER: " bun " } })).toMatchObject({
            command: "bun run test",
        });
    });

    it("detects packageManager while walking up from a workspace", () => {
        const root = mkdtempSync(join(tmpdir(), "refarm-toolbox-pm-"));
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

    it("falls back to npm when no supported package manager is configured", () => {
        expect(detectPackageManager({ cwd: tmpdir(), env: {} })).toBe("npm");
    });

    it("re-exports frozen install command resolution", () => {
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "pnpm" } })).toMatchObject({
            command: "pnpm",
            args: ["install", "--frozen-lockfile"],
            display: "pnpm install --frozen-lockfile",
        });
    });
});
