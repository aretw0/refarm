import fs from "node:fs";
import path from "node:path";

const DEFAULT_MAX_LINES = 1000;
const DEFAULT_REPORT_LIMIT = 10;
const DEFAULT_EXTENSIONS = new Set([
    ".cjs",
    ".js",
    ".jsx",
    ".json",
    ".md",
    ".mjs",
    ".rs",
    ".ts",
    ".tsx",
    ".yaml",
    ".yml",
]);
const DEFAULT_SKIP_DIRS = new Set([
    ".git",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "target",
    "tmp",
]);

/**
 * ComplexityAuditor: generic large-file pressure detector.
 * It is opt-in from the Refarm CLI policy so existing backlogs can be ratcheted.
 */
export class ComplexityAuditor {
    #maxLines;
    #paths;
    #files;
    #allowedPatterns;
    #allowedRules;
    #reportLimit;

    constructor(options = {}) {
        this.#maxLines = Number.isFinite(options.maxLines) && options.maxLines > 0
            ? Math.floor(options.maxLines)
            : DEFAULT_MAX_LINES;
        this.#paths = Array.isArray(options.paths) && options.paths.length > 0
            ? options.paths
            : ["."];
        this.#files = Array.isArray(options.files)
            ? options.files.filter((file) => typeof file === "string" && file.length > 0)
            : [];
        this.#allowedPatterns = Array.isArray(options.allowedPatterns)
            ? options.allowedPatterns.filter((pattern) => typeof pattern === "string" && pattern.length > 0)
            : [];
        this.#allowedRules = Array.isArray(options.allowedRules)
            ? options.allowedRules.filter(isAllowedRule)
            : [];
        this.#reportLimit = Number.isFinite(options.reportLimit) && options.reportLimit > 0
            ? Math.floor(options.reportLimit)
            : DEFAULT_REPORT_LIMIT;
    }

    get id() { return "complexity"; }
    get title() { return "Complexity Pressure"; }

    async audit(context = {}) {
        const rootDir = context.rootDir || process.cwd();
        const findings = this.scan(rootDir);
        const blockingFindings = findings.filter((finding) => !finding.allowed);
        const allowedFindings = findings.filter((finding) => finding.allowed);
        return {
            ok: blockingFindings.length === 0,
            maxLines: this.#maxLines,
            reportLimit: this.#reportLimit,
            findings,
            blockingFindings,
            allowedFindings,
            topBlockingFindings: blockingFindings.slice(0, this.#reportLimit),
            topFindings: findings.slice(0, this.#reportLimit),
            summaryByCategory: summarizeByCategory(findings),
        };
    }

    scan(rootDir) {
        const files = [];
        if (this.#files.length > 0) {
            for (const file of this.#files) {
                const absoluteFile = path.isAbsolute(file) ? file : path.resolve(rootDir, file);
                if (fs.existsSync(absoluteFile)) files.push(absoluteFile);
            }
        } else {
            for (const configuredPath of this.#paths) {
                const absolutePath = path.resolve(rootDir, configuredPath);
                if (!fs.existsSync(absolutePath)) continue;
                this.#collectFiles(absolutePath, files);
            }
        }

        return files
            .flatMap((file) => this.#findingForFile(rootDir, file))
            .sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));
    }

    #collectFiles(currentPath, files) {
        const stats = fs.lstatSync(currentPath);
        if (stats.isSymbolicLink()) return;
        if (!stats.isDirectory()) {
            files.push(currentPath);
            return;
        }

        for (const entry of fs.readdirSync(currentPath).sort()) {
            if (DEFAULT_SKIP_DIRS.has(entry)) continue;
            this.#collectFiles(path.join(currentPath, entry), files);
        }
    }

    #findingForFile(rootDir, file) {
        const relativeFile = normalizePath(path.relative(rootDir, file));
        const extension = path.extname(relativeFile);
        if (!DEFAULT_EXTENSIONS.has(extension)) return [];

        const text = fs.readFileSync(file, "utf-8");
        const lines = countLines(text);
        if (lines <= this.#maxLines) return [];

        const allowedReason = this.#allowedReason(relativeFile);
        const stats = fs.statSync(file);
        return [{
            category: classifyFile(relativeFile),
            file: relativeFile,
            lines,
            size: stats.size,
            type: "complexity_large_file",
            allowed: Boolean(allowedReason),
            note: allowedReason || "over-limit",
        }];
    }

    #allowedReason(file) {
        for (const rule of this.#allowedRules) {
            if (matchesPattern(file, rule.pattern)) return rule.note;
        }
        for (const pattern of this.#allowedPatterns) {
            if (matchesPattern(file, pattern)) return `allowed:${pattern}`;
        }
        return null;
    }
}

function countLines(text) {
    if (text.length === 0) return 0;
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function classifyFile(file) {
    if (file.startsWith(".project/")) return "project-state";
    if (file.includes("/fixtures/")) return "fixture";
    if (file.includes("/test/") || file.includes(".test.")) return "test";
    if (file.startsWith("docs/") || file.startsWith("specs/") || file.endsWith(".md")) return "docs";
    if (file.startsWith("scripts/")) return "script";
    if (file.startsWith("apps/") || file.startsWith("packages/") || file.startsWith("validations/")) {
        return "source";
    }
    return "other";
}

function isAllowedRule(value) {
    if (!value || typeof value !== "object") return false;
    return typeof value.pattern === "string"
        && value.pattern.length > 0
        && typeof value.note === "string"
        && value.note.startsWith("allowed:");
}

function summarizeByCategory(findings) {
    return Object.fromEntries(Object.entries(findings.reduce((summary, finding) => {
        const current = summary[finding.category] ?? {
            allowed: 0,
            blocking: 0,
            files: 0,
            maxLines: 0,
            totalLines: 0,
        };
        current.files += 1;
        current.totalLines += finding.lines;
        current.maxLines = Math.max(current.maxLines, finding.lines);
        if (finding.allowed) current.allowed += 1;
        else current.blocking += 1;
        return { ...summary, [finding.category]: current };
    }, {})).sort(([left], [right]) => left.localeCompare(right)));
}

function matchesPattern(value, pattern) {
    const normalizedPattern = normalizePath(pattern);
    if (normalizedPattern.startsWith("**/*")) {
        return value.endsWith(normalizedPattern.slice(4));
    }
    if (normalizedPattern.endsWith("/**")) {
        return value.startsWith(normalizedPattern.slice(0, -2));
    }
    return value === normalizedPattern;
}

function normalizePath(value) {
    return value.split(path.sep).join("/");
}
