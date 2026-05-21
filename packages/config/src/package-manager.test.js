import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    createPackageScriptCommand,
    detectPackageManager,
    packageBinaryCommand,
    packageFrozenInstallCommand,
    packageInstallCommand,
    packagePublishDryRunCommand,
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

    it("formats package binary commands for each supported manager", () => {
        expect(
            packageBinaryCommand("turbo", ["gen", "package"], {
                env: { REFARM_PACKAGE_MANAGER: "pnpm" },
            }),
        ).toMatchObject({
            command: "pnpm",
            args: ["exec", "turbo", "gen", "package"],
            display: "pnpm exec turbo gen package",
        });
        expect(
            packageBinaryCommand("turbo", ["gen", "package"], {
                env: { REFARM_PACKAGE_MANAGER: "npm" },
            }),
        ).toMatchObject({
            command: "npm",
            args: ["exec", "--", "turbo", "gen", "package"],
            display: "npm exec -- turbo gen package",
        });
        expect(
            packageBinaryCommand("turbo", ["gen", "package"], {
                env: { REFARM_PACKAGE_MANAGER: "yarn" },
            }),
        ).toMatchObject({
            command: "yarn",
            args: ["turbo", "gen", "package"],
            display: "yarn turbo gen package",
        });
        expect(
            packageBinaryCommand("turbo", ["gen", "package"], {
                env: { REFARM_PACKAGE_MANAGER: "bun" },
            }),
        ).toMatchObject({
            command: "bun",
            args: ["x", "turbo", "gen", "package"],
            display: "bun x turbo gen package",
        });
    });

    it("formats frozen install commands for each supported manager", () => {
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "pnpm" } })).toMatchObject({
            command: "pnpm",
            args: ["install", "--frozen-lockfile"],
            display: "pnpm install --frozen-lockfile",
        });
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "npm" } })).toMatchObject({
            command: "npm",
            args: ["ci"],
            display: "npm ci",
        });
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "yarn" } })).toMatchObject({
            command: "yarn",
            args: ["install", "--immutable"],
            display: "yarn install --immutable",
        });
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "bun" } })).toMatchObject({
            command: "bun",
            args: ["install", "--frozen-lockfile"],
            display: "bun install --frozen-lockfile",
        });
    });

    it("formats publish dry-run commands for each supported manager", () => {
        expect(packagePublishDryRunCommand({ env: { REFARM_PACKAGE_MANAGER: "pnpm" } })).toMatchObject({
            command: "pnpm publish --dry-run",
        });
        expect(packagePublishDryRunCommand({ env: { REFARM_PACKAGE_MANAGER: "npm" } })).toMatchObject({
            command: "npm publish --dry-run",
        });
        expect(packagePublishDryRunCommand({ env: { REFARM_PACKAGE_MANAGER: "yarn" } })).toMatchObject({
            command: "yarn npm publish --dry-run",
        });
        expect(packagePublishDryRunCommand({ env: { REFARM_PACKAGE_MANAGER: "bun" } })).toMatchObject({
            command: "bun publish --dry-run",
        });
    });
});
