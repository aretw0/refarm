import { execSync } from "node:child_process";

/**
 * GitHub Infrastructure Provider Bridge
 */
export class GitHubProvider {
    constructor(config) {
        this.config = config;
        this.org = config.brand?.slug || "refarm-dev";
    }

    /**
     * Mirror a repository to a target URL
     */
    async mirrorRepo(repoName, targetUrl) {
        console.log(`[github] Mirroring ${repoName} to ${targetUrl}...`);
        const sourceUrl = `${this.config.brand.urls.repository.replace(".git", "")}/${repoName}.git`;
        
        // Use git --mirror for full fidelity of branches and tags
        try {
            execSync(`git clone --mirror ${sourceUrl} temp-mirror`, { stdio: 'inherit' });
            execSync(`cd temp-mirror && git push --mirror ${targetUrl}`, { stdio: 'inherit' });
            execSync(`rm -rf temp-mirror`);
            return true;
        } catch (e) {
            console.error(`[github] Failed to mirror ${repoName}:`, e.message);
            return false;
        }
    }

    /**
     * List repositories in the organization using gh CLI
     */
    async listRepos() {
        try {
            const output = execSync(`gh repo list ${this.org} --json name --jq '.[].name'`, { encoding: 'utf-8' });
            return output.trim().split('\n');
        } catch (e) {
            console.error(`[github] Failed to list repos for ${this.org}:`, e.message);
            return [];
        }
    }
}
