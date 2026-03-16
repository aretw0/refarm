import fs from "node:fs";
import path from "node:path";

/**
 * FileSystemAuditor: Generic primitives for filesystem and Git visibility.
 * No knowledge of Refarm or Node.js structures.
 */
export class FileSystemAuditor {
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

    /**
     * Crawls and checks if files are ignored by Git.
     */
    async checkGitVisibility(rootDir, targetPath) {
        const issues = [];
        try {
            const git = (await import("isomorphic-git")).default;
            const allFiles = this.#getAllFiles(targetPath);
            
            for (const file of allFiles) {
                const relativePath = path.relative(rootDir, file);
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

    #getAllFiles(dirPath, arrayOfFiles = []) {
        if (!fs.existsSync(dirPath)) return arrayOfFiles;
        const stats = fs.statSync(dirPath);
        
        if (!stats.isDirectory()) {
            arrayOfFiles.push(dirPath);
            return arrayOfFiles;
        }

        const files = fs.readdirSync(dirPath);
        files.forEach((file) => {
            const childPath = path.join(dirPath, file);
            if (fs.statSync(childPath).isDirectory()) {
                if (file !== "node_modules" && file !== ".git" && file !== "dist") {
                    this.#getAllFiles(childPath, arrayOfFiles);
                }
            } else {
                arrayOfFiles.push(childPath);
            }
        });

        return arrayOfFiles;
    }
}
