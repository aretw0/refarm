import fs from "node:fs";
import path from "node:path";

export const PACKAGE_MANAGERS = ["pnpm", "npm", "yarn", "bun"];

export function parsePackageManager(value) {
    if (typeof value !== "string") return null;
    const name = value.trim().split("@")[0]?.trim();
    return PACKAGE_MANAGERS.includes(name) ? name : null;
}

function detectPackageManagerFromPackageJson(startDir) {
    let current = path.resolve(startDir);
    while (true) {
        const packageJsonPath = path.join(current, "package.json");
        if (fs.existsSync(packageJsonPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
                const detected = parsePackageManager(pkg.packageManager);
                if (detected) return detected;
            } catch {
                // Keep walking toward the filesystem root.
            }
        }

        const parent = path.dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

export function detectPackageManager({ cwd = process.cwd(), env = process.env } = {}) {
    const override = parsePackageManager(env.REFARM_PACKAGE_MANAGER);
    if (override) return override;

    return detectPackageManagerFromPackageJson(cwd) ?? "npm";
}

function relativeCwd(cwd, repoRoot) {
    if (!path.isAbsolute(cwd)) return cwd;
    const relative = repoRoot ? path.relative(repoRoot, cwd) : path.relative(process.cwd(), cwd);
    return relative && !relative.startsWith("..") ? relative : cwd;
}

export function createPackageScriptCommand({
    cwd,
    script,
    repoRoot,
    env = process.env,
}) {
    const packageManager = detectPackageManager({
        cwd: repoRoot ?? cwd,
        env,
    });
    const commandCwd = relativeCwd(cwd, repoRoot);

    switch (packageManager) {
        case "pnpm":
            return {
                packageManager,
                command: "pnpm",
                args: ["-C", commandCwd, "run", script],
                display: `pnpm -C ${commandCwd} run ${script}`,
            };
        case "npm":
            return {
                packageManager,
                command: "npm",
                args: ["--prefix", commandCwd, "run", script],
                display: `npm --prefix ${commandCwd} run ${script}`,
            };
        case "yarn":
            return {
                packageManager,
                command: "yarn",
                args: ["--cwd", commandCwd, "run", script],
                display: `yarn --cwd ${commandCwd} run ${script}`,
            };
        case "bun":
            return {
                packageManager,
                command: "bun",
                args: ["--cwd", commandCwd, "run", script],
                display: `bun --cwd ${commandCwd} run ${script}`,
            };
        default:
            throw new Error(`Unsupported package manager: ${packageManager}`);
    }
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
