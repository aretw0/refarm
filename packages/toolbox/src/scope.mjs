import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const DEP_KEYS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
    "bundleDependencies",
    "bundledDependencies"
];

const ASSIGNMENT_KEYS = ["dev", "me", "social"];
const SUPPORTED_WORKSPACE_ROOTS = ["apps", "packages", "validations", "templates"];

function parseArgs(argv) {
    const args = {
        action: "status",
        profile: undefined,
        setActive: false,
        includeTemplates: false,
        format: "text",
        output: undefined,
        requireCleanGit: false,
        workspaces: ["apps", "packages", "validations"],
        exclude: [],
        failOnCollision: false
    };

    if (argv[0] === "apply" || argv[0] === "status") {
        args.action = argv[0];
    }

    for (let i = 1; i < argv.length; i += 1) {
        const token = argv[i];
        if (token === "--profile" && argv[i + 1]) {
            args.profile = argv[i + 1];
            i += 1;
            continue;
        }
        if (token === "--set-active") {
            args.setActive = true;
            continue;
        }
        if (token === "--include-templates") {
            args.includeTemplates = true;
            continue;
        }
        if (token === "--format" && argv[i + 1]) {
            args.format = argv[i + 1];
            i += 1;
            continue;
        }
        if (token === "--output" && argv[i + 1]) {
            args.output = argv[i + 1];
            i += 1;
            continue;
        }
        if (token === "--require-clean-git") {
            args.requireCleanGit = true;
            continue;
        }
        if (token === "--workspaces" && argv[i + 1]) {
            args.workspaces = argv[i + 1]
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean);
            i += 1;
            continue;
        }
        if (token === "--exclude" && argv[i + 1]) {
            args.exclude = argv[i + 1]
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean);
            i += 1;
            continue;
        }
        if (token === "--fail-on-collision") {
            args.failOnCollision = true;
            continue;
        }
    }

    if (!args.workspaces.length) {
        args.workspaces = ["apps", "packages", "validations"];
    }

    return args;
}

function validateArgs(args) {
    if (!["status", "apply"].includes(args.action)) {
        printUsageAndExit();
    }
    if (!["text", "json"].includes(args.format)) {
        throw new Error(`Invalid --format '${args.format}'. Supported: text,json`);
    }

    for (const workspace of args.workspaces) {
        if (!SUPPORTED_WORKSPACE_ROOTS.includes(workspace)) {
            throw new Error(
                `Invalid workspace '${workspace}'. Supported: ${SUPPORTED_WORKSPACE_ROOTS.join(",")}`
            );
        }
    }
}

function loadJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function saveJson(filePath, data) {
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function isIgnoredDir(name) {
    return ["node_modules", ".git", ".turbo", "dist", "build", "target", "coverage"].includes(name);
}

function collectPackageJsonFiles(rootDir, roots, excludePrefixes) {
    const excluded = new Set(excludePrefixes.map((item) => item.replace(/^\/+/, "")));

    const files = [];

    function walk(dirPath) {
        if (!fs.existsSync(dirPath)) return;
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                if (isIgnoredDir(entry.name)) continue;
                walk(fullPath);
                continue;
            }
            if (entry.name === "package.json") {
                const relPath = normalizeRelPath(rootDir, fullPath);
                const relDir = relPath.replace(/\/package\.json$/, "");
                let skip = false;
                for (const prefix of excluded) {
                    if (!prefix) continue;
                    if (relDir === prefix || relDir.startsWith(`${prefix}/`)) {
                        skip = true;
                        break;
                    }
                }
                if (!skip) {
                    files.push(fullPath);
                }
            }
        }
    }

    for (const root of roots) {
        walk(path.join(rootDir, root));
    }

    return files.sort((a, b) => a.localeCompare(b));
}

function ensureScopeConfig(configPath, config) {
    config.brand = config.brand || {};
    config.brand.scopes = config.brand.scopes || {};
    config.brand.scopeProfiles = config.brand.scopeProfiles || {};
    config.brand.scopeAssignments = config.brand.scopeAssignments || {};

    if (!config.brand.scopeProfiles.organization) {
        config.brand.scopeProfiles.organization = {
            dev: "@refarm.dev",
            me: "@refarm.me",
            social: "@refarm.social"
        };
    }

    if (!config.brand.scopeProfiles.personal) {
        const fallback = config.brand.scopes.dev || "@aretw0";
        config.brand.scopeProfiles.personal = {
            dev: fallback,
            me: fallback,
            social: fallback
        };
    }

    if (!config.brand.activeScopeProfile) {
        config.brand.activeScopeProfile = "personal";
    }

    if (!config.brand.scopeAssignments.default) {
        config.brand.scopeAssignments.default = "dev";
    }

    if (!config.brand.scopeAssignments["apps/me"]) {
        config.brand.scopeAssignments["apps/me"] = "me";
    }

    if (!config.brand.scopeAssignments["packages/identity-nostr"]) {
        config.brand.scopeAssignments["packages/identity-nostr"] = "me";
    }

    saveJson(configPath, config);
}

function resolveProfile(config, profileName) {
    const profiles = config.brand?.scopeProfiles || {};
    const active = config.brand?.activeScopeProfile;
    const selected = profileName || active;

    if (!selected || !profiles[selected]) {
        const available = Object.keys(profiles);
        throw new Error(
            `Scope profile '${selected || "(none)"}' not found. Available: ${available.join(", ") || "(none)"}`
        );
    }

    return { name: selected, scopes: profiles[selected] };
}

function normalizeRelPath(rootDir, absolutePath) {
    return path.relative(rootDir, absolutePath).split(path.sep).join("/");
}

function resolveScopeKey(relPackageJsonPath, assignmentConfig) {
    const relDir = relPackageJsonPath.replace(/\/package\.json$/, "");
    const normalized = relDir.split(path.sep).join("/");

    let bestMatch = "";
    let bestScopeKey = assignmentConfig.default || "dev";

    for (const [prefix, scopeKey] of Object.entries(assignmentConfig)) {
        if (prefix === "default") continue;
        if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
            if (prefix.length > bestMatch.length) {
                bestMatch = prefix;
                bestScopeKey = scopeKey;
            }
        }
    }

    if (!ASSIGNMENT_KEYS.includes(bestScopeKey)) {
        throw new Error(`Invalid scope assignment '${bestScopeKey}' for ${relPackageJsonPath}`);
    }

    return bestScopeKey;
}

function withScope(scope, pkgSuffix) {
    if (!scope || !scope.startsWith("@")) {
        throw new Error(`Invalid scope '${scope}'`);
    }
    return `${scope}/${pkgSuffix}`;
}

function buildPlan(rootDir, packageJsonFiles, profile, assignmentConfig) {
    const packageInfos = [];
    const nameMap = new Map();
    const collisions = [];

    for (const filePath of packageJsonFiles) {
        const relPath = normalizeRelPath(rootDir, filePath);
        const json = loadJson(filePath);
        const currentName = json.name;
        if (!currentName || !currentName.includes("/")) continue;
        if (!currentName.startsWith("@")) continue;

        const pkgSuffix = currentName.split("/").slice(1).join("/");
        const scopeKey = resolveScopeKey(relPath, assignmentConfig);
        const targetScope = profile.scopes[scopeKey];

        if (!targetScope) {
            throw new Error(`Profile '${profile.name}' missing scope for key '${scopeKey}'`);
        }

        const targetName = withScope(targetScope, pkgSuffix);
        packageInfos.push({
            filePath,
            relPath,
            json,
            currentName,
            targetName,
            pkgSuffix,
            scopeKey
        });
    }

    // If multiple packages collapse to the same target name under a unified scope profile,
    // disambiguate by prefixing the logical scope key into the package suffix.
    const grouped = new Map();
    for (const info of packageInfos) {
        const bucket = grouped.get(info.targetName) || [];
        bucket.push(info);
        grouped.set(info.targetName, bucket);
    }

    for (const infos of grouped.values()) {
        if (infos.length <= 1) continue;
        const originalTarget = infos[0].targetName;
        for (const info of infos) {
            info.targetName = withScope(profile.scopes[info.scopeKey], `${info.scopeKey}-${info.pkgSuffix}`);
            info.collisionAdjusted = true;
        }
        collisions.push({
            target: originalTarget,
            files: infos.map((item) => item.relPath),
            resolvedAs: infos.map((item) => item.targetName)
        });
    }

    for (const info of packageInfos) {
        nameMap.set(info.currentName, info.targetName);
    }

    return { packageInfos, nameMap, collisions };
}

function renameDependencySection(section, nameMap) {
    if (!section || typeof section !== "object") return { updated: section, changed: 0 };

    let changed = 0;
    const updated = {};
    for (const [depName, depVersion] of Object.entries(section)) {
        const mapped = nameMap.get(depName) || depName;
        if (mapped !== depName) changed += 1;
        updated[mapped] = depVersion;
    }
    return { updated, changed };
}

function applyPlan(plan, write) {
    let renamedPackages = 0;
    let rewrittenDeps = 0;

    for (const pkg of plan.packageInfos) {
        const next = { ...pkg.json };
        let changed = false;

        if (pkg.currentName !== pkg.targetName) {
            next.name = pkg.targetName;
            renamedPackages += 1;
            changed = true;
        }

        for (const key of DEP_KEYS) {
            const currentSection = next[key];
            const { updated, changed: sectionChanged } = renameDependencySection(currentSection, plan.nameMap);
            if (sectionChanged > 0) {
                next[key] = updated;
                rewrittenDeps += sectionChanged;
                changed = true;
            }
        }

        if (changed && write) {
            saveJson(pkg.filePath, next);
        }
    }

    return { renamedPackages, rewrittenDeps };
}

function printPreview(plan, profileName) {
    const changes = plan.packageInfos.filter((p) => p.currentName !== p.targetName);
    const collisions = changes.filter((p) => p.collisionAdjusted);
    console.log(`\n📌 Scope profile: ${profileName}`);
    console.log(`📦 Workspace packages scanned: ${plan.packageInfos.length}`);
    console.log(`🔄 Package rename candidates: ${changes.length}`);
    if (collisions.length > 0) {
        console.log(`⚠️ Collision-safe renames applied: ${collisions.length}`);
    }

    const sample = changes.slice(0, 20);
    if (sample.length > 0) {
        console.log("\nPreview (first 20):");
        for (const item of sample) {
            console.log(`  - ${item.currentName} -> ${item.targetName} (${item.relPath})`);
        }
        if (changes.length > sample.length) {
            console.log(`  ... and ${changes.length - sample.length} more`);
        }
    }
}

function buildSummary(plan, profileName, args) {
    const changes = plan.packageInfos.filter((p) => p.currentName !== p.targetName);
    const collisions = changes.filter((p) => p.collisionAdjusted);

    return {
        profile: profileName,
        scannedPackages: plan.packageInfos.length,
        renameCandidates: changes.length,
        collisionAdjustedCount: collisions.length,
        collisionGroups: plan.collisions,
        workspaces: args.workspaces,
        excluded: args.exclude,
        changes: changes.map((item) => ({
            file: item.relPath,
            from: item.currentName,
            to: item.targetName,
            scopeKey: item.scopeKey,
            collisionAdjusted: Boolean(item.collisionAdjusted)
        }))
    };
}

function printJson(summary) {
    console.log(JSON.stringify(summary, null, 2));
}

function writeOutputFile(rootDir, outputPath, summary) {
    if (!outputPath) return;
    const finalPath = path.isAbsolute(outputPath) ? outputPath : path.join(rootDir, outputPath);
    const parent = path.dirname(finalPath);
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(finalPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
    console.log(`\n📝 Scope summary written to: ${normalizeRelPath(rootDir, finalPath)}`);
}

function assertCleanGit(rootDir) {
    const out = execSync("git status --porcelain", { cwd: rootDir, stdio: ["ignore", "pipe", "pipe"] })
        .toString()
        .trim();
    if (out) {
        throw new Error("Working tree is not clean. Commit/stash first or remove --require-clean-git.");
    }
}

function printUsageAndExit() {
    console.log(
        "Usage: refarm-task scope <status|apply> [--profile <name>] [--set-active] [--include-templates] [--workspaces apps,packages] [--exclude apps/me] [--format text|json] [--output <file>] [--require-clean-git] [--fail-on-collision]"
    );
    process.exit(1);
}

async function main() {
    const args = parseArgs(process.argv.slice(3));
    validateArgs(args);

    const rootDir = process.cwd();
    const configPath = path.join(rootDir, "refarm.config.json");
    if (!fs.existsSync(configPath)) {
        throw new Error("refarm.config.json not found. Run from repository root.");
    }

    const config = loadJson(configPath);
    ensureScopeConfig(configPath, config);

    const refreshedConfig = loadJson(configPath);
    const profile = resolveProfile(refreshedConfig, args.profile);
    const roots = new Set(args.workspaces);
    if (args.includeTemplates) roots.add("templates");
    const packageJsonFiles = collectPackageJsonFiles(rootDir, Array.from(roots), args.exclude);

    if (args.requireCleanGit) {
        assertCleanGit(rootDir);
    }

    const plan = buildPlan(
        rootDir,
        packageJsonFiles,
        profile,
        refreshedConfig.brand.scopeAssignments || { default: "dev" }
    );

    if (args.failOnCollision && plan.collisions.length > 0) {
        throw new Error(
            `Found ${plan.collisions.length} collision group(s). Re-run without --fail-on-collision or update scopeAssignments.`
        );
    }

    const summary = buildSummary(plan, profile.name, args);

    if (args.format === "json") {
        printJson(summary);
    } else {
        printPreview(plan, profile.name);
    }

    writeOutputFile(rootDir, args.output, summary);

    if (args.action === "status") {
        if (args.format === "text") {
            console.log("\nNo files changed (status mode). Use 'refarm-task scope apply --profile <name>' to apply.");
        }
        return;
    }

    const result = applyPlan(plan, true);

    if (args.setActive) {
        refreshedConfig.brand = refreshedConfig.brand || {};
        refreshedConfig.brand.activeScopeProfile = profile.name;
        saveJson(configPath, refreshedConfig);
    }

    console.log("\n✅ Scope migration applied.");
    console.log(`   - Packages renamed: ${result.renamedPackages}`);
    console.log(`   - Internal dependency refs updated: ${result.rewrittenDeps}`);
    if (args.setActive) {
        console.log(`   - Active scope profile updated to: ${profile.name}`);
    }
    console.log("\nNext: run 'npm install' to refresh lockfile/workspace links.");
}

main().catch((error) => {
    console.error("❌ scope command failed:", error.message || error);
    process.exit(1);
});
