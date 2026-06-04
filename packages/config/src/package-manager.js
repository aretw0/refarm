import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"];
export const PACKAGE_MANAGER_OVERRIDE_ENV_VAR = "REFARM_PACKAGE_MANAGER";

export function parsePackageManager(value) {
    if (typeof value !== "string") return null;
    const name = value.trim().split("@")[0]?.trim();
    return PACKAGE_MANAGERS.includes(name) ? name : null;
}

export function packageManagerOverrideDiagnostic(env = process.env) {
    const value = env[PACKAGE_MANAGER_OVERRIDE_ENV_VAR];
    if (value === undefined || parsePackageManager(value)) return null;
    return {
        name: PACKAGE_MANAGER_OVERRIDE_ENV_VAR,
        value,
        valid: PACKAGE_MANAGERS,
    };
}

function detectPackageManagerFromPackageJson(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        const packageJsonPath = path.join(current, "package.json");
        if (existsSync(packageJsonPath)) {
            try {
                const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
                const detected = parsePackageManager(pkg.packageManager);
                if (detected) return detected;
            } catch {
                // Keep walking toward the filesystem root.
            }
        }

        const lockfileDetected = detectPackageManagerFromLockfile(current);
        if (lockfileDetected) return lockfileDetected;

        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

function detectPackageManagerFromLockfile(dir) {
    if (existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
    if (existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, "bun.lockb"))) return "bun";
    if (existsSync(path.join(dir, "yarn.lock"))) return "yarn";
    if (
        existsSync(path.join(dir, "package-lock.json")) ||
        existsSync(path.join(dir, "npm-shrinkwrap.json"))
    ) {
        return "npm";
    }
    return null;
}

export function detectPackageManager({ cwd = process.cwd(), env = process.env } = {}) {
    const override = parsePackageManager(env[PACKAGE_MANAGER_OVERRIDE_ENV_VAR]);
    if (override) return override;

    return detectPackageManagerFromPackageJson(cwd) ?? "npm";
}

function relativeCwd(cwd, repoRoot) {
    if (!path.isAbsolute(cwd)) return cwd;
    const relative = repoRoot ? path.relative(repoRoot, cwd) : path.relative(process.cwd(), cwd);
    return relative && !relative.startsWith("..") ? relative.replace(/\\/g, "/") : cwd;
}

function quoteDisplayArgIfNeeded(value) {
    return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function formatDisplayArgs(args) {
    return args.map(quoteDisplayArgIfNeeded).join(" ");
}

export function createPackageScriptCommand({
    cwd,
    script,
    repoRoot,
    env = process.env,
    args = [],
}) {
    const packageManager = detectPackageManager({
        cwd: repoRoot ?? cwd,
        env,
    });
    const commandCwd = relativeCwd(cwd, repoRoot);
    const displayCwd = quoteDisplayArgIfNeeded(commandCwd);
    const displayScript = quoteDisplayArgIfNeeded(script);

    switch (packageManager) {
        case "pnpm":
            return {
                packageManager,
                command: "pnpm",
                args: ["-C", commandCwd, "run", script, ...args],
                display: `pnpm -C ${displayCwd} run ${displayScript}${formatArgsDisplay(args)}`,
            };
        case "npm":
            return {
                packageManager,
                command: "npm",
                args: ["--prefix", commandCwd, "run", script, ...(args.length > 0 ? ["--", ...args] : [])],
                display: `npm --prefix ${displayCwd} run ${displayScript}${formatNpmArgsDisplay(args)}`,
            };
        case "yarn":
            return {
                packageManager,
                command: "yarn",
                args: ["--cwd", commandCwd, "run", script, ...args],
                display: `yarn --cwd ${displayCwd} run ${displayScript}${formatArgsDisplay(args)}`,
            };
        case "bun":
            return {
                packageManager,
                command: "bun",
                args: ["--cwd", commandCwd, "run", script, ...args],
                display: `bun --cwd ${displayCwd} run ${displayScript}${formatArgsDisplay(args)}`,
            };
        default:
            throw new Error(`Unsupported package manager: ${packageManager}`);
    }
}

function formatArgsDisplay(args) {
    return args.length > 0 ? ` ${formatDisplayArgs(args)}` : "";
}

function formatNpmArgsDisplay(args) {
    return args.length > 0 ? ` -- ${formatDisplayArgs(args)}` : "";
}

export function packageScriptCommand(script, { cwd = process.cwd(), env = process.env } = {}) {
    const packageManager = detectPackageManager({ cwd, env });
    const command = `${packageManager} run ${script}`;
    return {
        packageManager,
        command,
        display: command,
    };
}

export function packageInstallCommand({ cwd = process.cwd(), env = process.env } = {}) {
    const packageManager = detectPackageManager({ cwd, env });
    const command = `${packageManager} install`;
    return {
        packageManager,
        command,
        display: command,
    };
}

export function packageFrozenInstallCommand({ cwd = process.cwd(), env = process.env } = {}) {
    const packageManager = detectPackageManager({ cwd, env });

    switch (packageManager) {
        case "pnpm":
            return {
                packageManager,
                command: "pnpm",
                args: ["install", "--frozen-lockfile"],
                display: "pnpm install --frozen-lockfile",
            };
        case "npm":
            return {
                packageManager,
                command: "npm",
                args: ["ci"],
                display: "npm ci",
            };
        case "yarn":
            return {
                packageManager,
                command: "yarn",
                args: ["install", "--immutable"],
                display: "yarn install --immutable",
            };
        case "bun":
            return {
                packageManager,
                command: "bun",
                args: ["install", "--frozen-lockfile"],
                display: "bun install --frozen-lockfile",
            };
        default:
            throw new Error(`Unsupported package manager: ${packageManager}`);
    }
}

export function packagePublishDryRunCommand({ cwd = process.cwd(), env = process.env } = {}) {
    const packageManager = detectPackageManager({ cwd, env });

    switch (packageManager) {
        case "pnpm":
        case "npm":
            return {
                packageManager,
                command: `${packageManager} publish --dry-run`,
                display: `${packageManager} publish --dry-run`,
            };
        case "yarn":
            return {
                packageManager,
                command: "yarn npm publish --dry-run",
                display: "yarn npm publish --dry-run",
            };
        case "bun":
            return {
                packageManager,
                command: "bun publish --dry-run",
                display: "bun publish --dry-run",
            };
        default:
            throw new Error(`Unsupported package manager: ${packageManager}`);
    }
}

export function packageBinaryCommand(
    binary,
    args = [],
    { cwd = process.cwd(), env = process.env } = {},
) {
    const packageManager = detectPackageManager({ cwd, env });
    const allArgs = [binary, ...args];
    const displayArgs = formatDisplayArgs(allArgs);

    switch (packageManager) {
        case "pnpm":
            return {
                packageManager,
                command: "pnpm",
                args: ["exec", ...allArgs],
                display: `pnpm exec ${displayArgs}`,
            };
        case "npm":
            return {
                packageManager,
                command: "npm",
                args: ["exec", "--", ...allArgs],
                display: `npm exec -- ${displayArgs}`,
            };
        case "yarn":
            return {
                packageManager,
                command: "yarn",
                args: allArgs,
                display: `yarn ${displayArgs}`,
            };
        case "bun":
            return {
                packageManager,
                command: "bun",
                args: ["x", ...allArgs],
                display: `bun x ${displayArgs}`,
            };
        default:
            throw new Error(`Unsupported package manager: ${packageManager}`);
    }
}
