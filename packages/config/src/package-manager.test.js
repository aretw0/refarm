import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    PACKAGE_MANAGER_OVERRIDE_ENV_VAR,
    PACKAGE_MANAGERS,
    createPackageScriptCommand,
    detectPackageManager,
    packageBinaryCommand,
    packageFrozenInstallCommand,
    packageInstallCommand,
    packageManagerOverrideDiagnostic,
    packageManagerExecutable,
    packageManagerSpawnCommand,
    packagePublishDryRunCommand,
    packageScriptCommand,
} from "./package-manager.js";

const pmCommand = (name) => packageManagerSpawnCommand(name).command;
const pmArgs = (name, args) => packageManagerSpawnCommand(name, args).args;

describe("package manager config", () => {
    it("honors REFARM_PACKAGE_MANAGER as an operator override", () => {
        expect(detectPackageManager({ env: { [PACKAGE_MANAGER_OVERRIDE_ENV_VAR]: " bun " } })).toBe("bun");
        expect(packageScriptCommand("test", { env: { [PACKAGE_MANAGER_OVERRIDE_ENV_VAR]: " bun " } })).toMatchObject({
            packageManager: "bun",
            command: "bun run test",
        });
    });

    it("describes ignored invalid REFARM_PACKAGE_MANAGER overrides", () => {
        expect(packageManagerOverrideDiagnostic({ [PACKAGE_MANAGER_OVERRIDE_ENV_VAR]: "pip" })).toEqual({
            name: PACKAGE_MANAGER_OVERRIDE_ENV_VAR,
            value: "pip",
            valid: PACKAGE_MANAGERS,
        });
        expect(packageManagerOverrideDiagnostic({ [PACKAGE_MANAGER_OVERRIDE_ENV_VAR]: "pnpm" })).toBeNull();
        expect(packageManagerOverrideDiagnostic({})).toBeNull();
    });

    it("uses Windows command shims only for spawnable package manager commands", () => {
        expect(packageManagerExecutable("pnpm", "win32")).toBe("pnpm.cmd");
        expect(packageManagerExecutable("pnpm", "linux")).toBe("pnpm");
        expect(packageManagerSpawnCommand("pnpm", ["--version"], "win32")).toEqual({
            command: "cmd.exe",
            args: ["/d", "/s", "/c", "pnpm.cmd", "--version"],
        });
        expect(packageManagerSpawnCommand("pnpm", ["--version"], "linux")).toEqual({
            command: "pnpm",
            args: ["--version"],
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

    it("detects package manager from workspace lockfiles before falling back", () => {
        const root = mkdtempSync(join(tmpdir(), "refarm-config-pm-lock-"));
        const app = join(root, "apps", "dev");
        mkdirSync(app, { recursive: true });
        writeFileSync(join(root, "package.json"), JSON.stringify({ name: "repo" }));
        writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
        writeFileSync(join(app, "package.json"), JSON.stringify({ name: "dev" }));

        try {
            expect(detectPackageManager({ cwd: app, env: {} })).toBe("pnpm");
            expect(
                createPackageScriptCommand({
                    cwd: app,
                    repoRoot: root,
                    script: "build",
                    env: {},
                }),
            ).toMatchObject({
                command: pmCommand("pnpm"),
                args: pmArgs("pnpm", ["-C", "apps/dev", "run", "build"]),
                display: "pnpm -C apps/dev run build",
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
            command: pmCommand("bun"),
            args: pmArgs("bun", ["--cwd", "apps/dev", "run", "preview"]),
            display: "bun --cwd apps/dev run preview",
        });
    });

    it("formats script commands with pass-through args for each supported manager", () => {
        expect(
            createPackageScriptCommand({
                cwd: ".",
                script: "imports:organize",
                args: ["--check", "apps/refarm/src/index.ts"],
                env: { REFARM_PACKAGE_MANAGER: "pnpm" },
            }),
        ).toMatchObject({
            command: pmCommand("pnpm"),
            args: pmArgs("pnpm", ["-C", ".", "run", "imports:organize", "--check", "apps/refarm/src/index.ts"]),
            display: "pnpm -C . run imports:organize --check apps/refarm/src/index.ts",
        });
        expect(
            createPackageScriptCommand({
                cwd: ".",
                script: "imports:organize",
                args: ["--check"],
                env: { REFARM_PACKAGE_MANAGER: "npm" },
            }),
        ).toMatchObject({
            command: pmCommand("npm"),
            args: pmArgs("npm", ["--prefix", ".", "run", "imports:organize", "--", "--check"]),
            display: "npm --prefix . run imports:organize -- --check",
        });
        expect(
            createPackageScriptCommand({
                cwd: ".",
                script: "imports:organize",
                args: ["--check"],
                env: { REFARM_PACKAGE_MANAGER: "yarn" },
            }),
        ).toMatchObject({
            command: pmCommand("yarn"),
            args: pmArgs("yarn", ["--cwd", ".", "run", "imports:organize", "--check"]),
            display: "yarn --cwd . run imports:organize --check",
        });
        expect(
            createPackageScriptCommand({
                cwd: ".",
                script: "imports:organize",
                args: ["--check"],
                env: { REFARM_PACKAGE_MANAGER: "bun" },
            }),
        ).toMatchObject({
            command: pmCommand("bun"),
            args: pmArgs("bun", ["--cwd", ".", "run", "imports:organize", "--check"]),
            display: "bun --cwd . run imports:organize --check",
        });
    });

    it("quotes display-only script command arguments when shell needs it", () => {
        expect(
            createPackageScriptCommand({
                cwd: "apps/my app",
                script: "check:types",
                args: ["--filter", "src/my file.ts"],
                env: { REFARM_PACKAGE_MANAGER: "pnpm" },
            }),
        ).toMatchObject({
            command: pmCommand("pnpm"),
            args: pmArgs("pnpm", ["-C", "apps/my app", "run", "check:types", "--filter", "src/my file.ts"]),
            display: "pnpm -C 'apps/my app' run check:types --filter 'src/my file.ts'",
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
            command: pmCommand("pnpm"),
            args: pmArgs("pnpm", ["exec", "turbo", "gen", "package"]),
            display: "pnpm exec turbo gen package",
        });
        expect(
            packageBinaryCommand("turbo", ["gen", "package"], {
                env: { REFARM_PACKAGE_MANAGER: "npm" },
            }),
        ).toMatchObject({
            command: pmCommand("npm"),
            args: pmArgs("npm", ["exec", "--", "turbo", "gen", "package"]),
            display: "npm exec -- turbo gen package",
        });
        expect(
            packageBinaryCommand("turbo", ["gen", "package"], {
                env: { REFARM_PACKAGE_MANAGER: "yarn" },
            }),
        ).toMatchObject({
            command: pmCommand("yarn"),
            args: pmArgs("yarn", ["turbo", "gen", "package"]),
            display: "yarn turbo gen package",
        });
        expect(
            packageBinaryCommand("turbo", ["gen", "package"], {
                env: { REFARM_PACKAGE_MANAGER: "bun" },
            }),
        ).toMatchObject({
            command: pmCommand("bun"),
            args: pmArgs("bun", ["x", "turbo", "gen", "package"]),
            display: "bun x turbo gen package",
        });
    });

    it("quotes display-only binary command arguments when shell needs it", () => {
        expect(
            packageBinaryCommand("my tool", ["--input", "plugin path.wasm"], {
                env: { REFARM_PACKAGE_MANAGER: "npm" },
            }),
        ).toMatchObject({
            command: pmCommand("npm"),
            args: pmArgs("npm", ["exec", "--", "my tool", "--input", "plugin path.wasm"]),
            display: "npm exec -- 'my tool' --input 'plugin path.wasm'",
        });
    });

    it("formats frozen install commands for each supported manager", () => {
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "pnpm" } })).toMatchObject({
            command: pmCommand("pnpm"),
            args: pmArgs("pnpm", ["install", "--frozen-lockfile"]),
            display: "pnpm install --frozen-lockfile",
        });
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "npm" } })).toMatchObject({
            command: pmCommand("npm"),
            args: pmArgs("npm", ["ci"]),
            display: "npm ci",
        });
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "yarn" } })).toMatchObject({
            command: pmCommand("yarn"),
            args: pmArgs("yarn", ["install", "--immutable"]),
            display: "yarn install --immutable",
        });
        expect(packageFrozenInstallCommand({ env: { REFARM_PACKAGE_MANAGER: "bun" } })).toMatchObject({
            command: pmCommand("bun"),
            args: pmArgs("bun", ["install", "--frozen-lockfile"]),
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
