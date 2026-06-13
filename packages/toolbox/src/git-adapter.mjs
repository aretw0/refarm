import { execSync } from "node:child_process";
import { loadConfig } from "@refarm.dev/config";

let resolvedGitHost = "github";
try {
    const config = loadConfig();
    if (config?.infrastructure?.gitHost) {
        resolvedGitHost = config.infrastructure.gitHost;
    }
} catch (err) {
    // Silent fallback for test environments where the root config is unavailable
}

export const gitHost = resolvedGitHost;

export const gitUrlAdapter = {
    checkCli: () => {
        if (gitHost === "github") {
            try {
                execSync('gh --version', { encoding: 'utf8', stdio: 'pipe' });
                execSync('gh auth status', { encoding: 'utf8', stdio: 'pipe' });
                return true;
            } catch {
                return false;
            }
        }
        return false;
    },
    cliName: gitHost === "github" ? "GitHub CLI (gh)" : gitHost,
    issue: {
        view: (id) => {
            if (gitHost === "github") {
                return execSync(`gh issue view ${id} --json title`, { encoding: 'utf8', stdio: 'pipe' }).trim();
            } else {
                throw new Error(`Git host adapter for '${gitHost}' is not implemented yet. Supported: github`);
            }
        },
        create: (title, label, body) => {
            if (gitHost === "github") {
                return execSync(`gh issue create --title "${title}" --label "${label}" --body "${body}"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
            } else {
                throw new Error(`Git host adapter for '${gitHost}' is not implemented yet. Supported: github`);
            }
        }
    },
    pr: {
        createCommand: (issueId) => {
            if (gitHost === "github") {
                const bodyFlag = issueId ? `--body "Fixes #${issueId}"` : "";
                return `gh pr create ${bodyFlag}`;
            } else {
                throw new Error(`Git host adapter for '${gitHost}' is not implemented yet. Supported: github`);
            }
        }
    },
    label: {
        ensure: (name, color, description) => {
            if (gitHost === "github") {
                try {
                    execSync(`gh label create "${name}" --color "${color}" --description "${description}"`, { stdio: "pipe" });
                } catch (err) {
                    // Label likely already exists, we skip
                }
            }
        }
    }
};
