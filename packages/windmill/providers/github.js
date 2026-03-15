import { execSync } from "node:child_process";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node/index.js";
import fs from "node:fs";
import path from "node:path";

/**
 * GitHub Infrastructure Provider Bridge
 * Handles repository mirroring and auditing for Refarm organizations.
 */
export class GitHubProvider {
    constructor(config) {
        this.config = config;
        this.token = process.env.GITHUB_TOKEN;
        this.org = config.brand?.owner || "refarm-dev";
    }

    /**
     * Mirror a repository to a target URL (e.g., for Escape Hatch / Backup)
     */
    async mirrorRepo(repoName, targetUrl, options = {}) {
        console.log(`[GitHub] Mirroring ${repoName} to backup target (Pure JS)...`);
        
        const sourceUrl = this.config.brand.urls.repository.replace(".git", "");
        const dir = path.join("/tmp", `mirror-${repoName}-${Date.now()}`);
        
        if (options.dryRun) {
            console.log(`[GitHub] [DRY RUN] Would mirror ${sourceUrl} to ${targetUrl}`);
            return { status: "dry-run", source: sourceUrl, target: targetUrl };
        }

        try {
            // 1. Clone (Pure JS)
            await git.clone({
                fs,
                http,
                dir,
                url: sourceUrl,
                singleBranch: false,
                depth: undefined // Full mirror
            });

            // 2. Push to target (Pure JS)
            await git.push({
                fs,
                http,
                dir,
                remote: "backup",
                url: targetUrl,
                onAuth: () => ({ username: this.token || "x-access-token", password: "" })
            });

            // 3. Cleanup
            fs.rmSync(dir, { recursive: true, force: true });
            
            return { status: "success" };
        } catch (e) {
            console.error(`[GitHub] Mirroring failed: ${e.message}`);
            // Fallback cleanup
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
            return { status: "error", message: e.message };
        }
    }

    /**
     * List repositories in the organization
     */
    async listRepos() {
        try {
            // Check if gh is authenticated first to avoid hangs
            execSync("gh auth status", { stdio: "ignore" });
            const output = execSync(`gh repo list ${this.org} --json name --jq '.[].name'`, { 
                encoding: "utf-8", 
                timeout: 5000 
            });
            return output.trim().split("\n").filter(Boolean);
        } catch (e) {
            console.warn(`[GitHub] gh CLI unavailable or unauthenticated, attempting dynamic fetch...`);
            return await this.listReposViaFetch();
        }
    }

    async listReposViaFetch() {
        if (!this.token) return [];
        const res = await fetch(`https://api.github.com/orgs/${this.org}/repos`, {
            headers: {
                "Authorization": `token ${this.token}`,
                "Accept": "application/vnd.github.v3+json"
            }
        });
        const data = await res.json();
        return Array.isArray(data) ? data.map(r => r.name) : [];
    }
}
