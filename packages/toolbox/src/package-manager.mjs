import fs from "node:fs";
import path from "node:path";

const SUPPORTED_PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "bun"]);

function normalizePackageManager(value) {
    if (typeof value !== "string") return null;
    const name = value.split("@")[0];
    return SUPPORTED_PACKAGE_MANAGERS.has(name) ? name : null;
}

export function detectPackageManager({ cwd = process.cwd(), env = process.env } = {}) {
    const override = normalizePackageManager(env.REFARM_PACKAGE_MANAGER);
    if (override) return override;

    let current = path.resolve(cwd);
    while (true) {
        const packageJsonPath = path.join(current, "package.json");
        if (fs.existsSync(packageJsonPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
                const detected = normalizePackageManager(pkg.packageManager);
                if (detected) return detected;
            } catch {
                // Keep walking toward the filesystem root.
            }
        }

        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }

    return "npm";
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
