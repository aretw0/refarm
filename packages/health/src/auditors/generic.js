import fs from "node:fs";
import path from "node:path";

/**
 * FileSystemAuditor: Generic primitives for filesystem and Git visibility.
 * No knowledge of Refarm or Node.js structures.
 */
export class FileSystemAuditor {
    #ignoredGitVisibilityPatterns;

    constructor(options = {}) {
        this.#ignoredGitVisibilityPatterns = options.ignoredGitVisibilityPatterns || [];
    }

    get id() { return "generic_fs"; }
    get title() { return "Generic FileSystem & Git Visibility"; }

    async audit(options = {}) {
        const rootDir = options.rootDir || process.cwd();
        const searchPath = options.searchPath || ".";
        const absolutePath = path.resolve(rootDir, searchPath);

        if (!fs.existsSync(absolutePath)) {
            return { error: `Path not found: ${absolutePath}` };
        }

        return {
            git: await this.checkGitVisibility(rootDir, absolutePath),
            structure: await this.analyzeStructure(absolutePath)
        };
    }

    // Source file extensions that should never be git-ignored
    static #SOURCE_EXTENSIONS = new Set([
        ".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx",
        ".rs", ".toml", ".json", ".md",
    ]);

    /**
     * Checks that source files (code, config, docs) are not accidentally git-ignored.
     * Build artifacts, generated files, and binaries are expected to be ignored.
     */
    async checkGitVisibility(rootDir, targetPath) {
        const issues = [];
        try {
            const git = (await import("isomorphic-git")).default;
            const allFiles = this.#getAllFiles(targetPath);

            for (const file of allFiles) {
                const ext = path.extname(file);
                if (!FileSystemAuditor.#SOURCE_EXTENSIONS.has(ext)) continue;

                const relativePath = path.relative(rootDir, file);
                if (this.#matchesIgnoredGitVisibilityPattern(relativePath)) continue;

                const ignored = await git.isIgnored({
                    fs,
                    dir: rootDir,
                    filepath: relativePath
                });

                if (ignored) {
                    issues.push({
                        file: relativePath,
                        type: "git_ignored",
                        path: file
                    });
                }
            }
        } catch (e) {
            console.error(`[Health:Generic] Git visibility check failed: ${e.message}`);
        }
        return issues;
    }

    #matchesIgnoredGitVisibilityPattern(relativePath) {
        const normalized = relativePath.split(path.sep).join("/");
        return this.#ignoredGitVisibilityPatterns.some((pattern) =>
            FileSystemAuditor.#matchesPattern(normalized, pattern)
        );
    }

    static #matchesPattern(value, pattern) {
        const normalizedPattern = pattern.split(path.sep).join("/");
        if (normalizedPattern.startsWith("**/*")) {
            return value.endsWith(normalizedPattern.slice(4));
        }
        if (normalizedPattern.endsWith("/**")) {
            return value.startsWith(normalizedPattern.slice(0, -2));
        }
        return value === normalizedPattern;
    }

    /**
     * Basic structure analysis.
     */
    async analyzeStructure(targetPath) {
        const stats = fs.statSync(targetPath);
        return {
            isDirectory: stats.isDirectory(),
            modifiedAt: stats.mtime.toISOString(),
            size: stats.size
        };
    }

    // Directories that are never hand-written source and should not be scanned.
    // Hidden directories (leading dot) are also skipped — they hold runtime state.
    static #SKIP_DIRS = new Set([
        "node_modules", "dist", "target", "coverage", "build", "tmp",
        // Generated output directories
        "pkg", "generated", "test-results", "benchmarks",
    ]);

    #getAllFiles(dirPath, arrayOfFiles = []) {
        if (!fs.existsSync(dirPath)) return arrayOfFiles;
        // lstatSync to avoid following symlinks that may point to non-existent targets
        const stats = fs.lstatSync(dirPath);

        if (stats.isSymbolicLink() || !stats.isDirectory()) {
            arrayOfFiles.push(dirPath);
            return arrayOfFiles;
        }

        const files = fs.readdirSync(dirPath);
        files.forEach((file) => {
            const childPath = path.join(dirPath, file);
            const childStats = fs.lstatSync(childPath);
            if (!childStats.isSymbolicLink() && childStats.isDirectory()) {
                // Skip named exclusions and all hidden directories (dotdirs = runtime state)
                if (!FileSystemAuditor.#SKIP_DIRS.has(file) && !file.startsWith(".")) {
                    this.#getAllFiles(childPath, arrayOfFiles);
                }
            } else {
                arrayOfFiles.push(childPath);
            }
        });

        return arrayOfFiles;
    }
}
