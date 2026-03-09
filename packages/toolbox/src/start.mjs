import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { gitUrlAdapter } from './git-adapter.mjs';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

function runCommand(command, throwOnError = true, silent = false) {
    try {
        return execSync(command, { encoding: 'utf8', stdio: silent ? 'pipe' : 'inherit' }).trim();
    } catch (err) {
        if (throwOnError) {
            console.error(`❌ Command failed: ${command}\n`, err.message);
            process.exit(1);
        }
        return null;
    }
}

function checkGitCli() {
    return gitUrlAdapter.checkCli();
}

async function main() {
    console.log("🚜 Welcome to Refarm Developer Toolbox: Task Start\n");

    // 1. Verify working directory is clean
    const statusLine = runCommand('git status --porcelain', true, true);
    if (statusLine && statusLine.length > 0) {
        console.error("❌ Your working tree is not clean. Please commit or stash your changes before starting a new task.");
        process.exit(1);
    }

    // 2. Check Git Host CLI
    const hasCli = checkGitCli();
    if (!hasCli) {
        console.log(`⚠️ ${gitUrlAdapter.cliName} not found or not authenticated. Some automated tracking features will be limited.\n`);
    }

    // 3. Select Workflow Mode
    console.log("Phases available:");
    console.log("  1) Feature / Issue Mode (Standard Flow - Unified Spec & Implementation)");
    console.log("  2) Hotfix Mode (Emergency bypass directly from main)");

    const phaseChoice = await question("Select phase (1-2) [1]: ");
    const phase = phaseChoice.trim() === '2' ? 'hotfix' : 'feature';

    let issueId = '';
    let issueTitle = '';

    if (phase === 'feature') {
        if (hasCli) {
            const inputIssueId = await question(`Enter ${gitUrlAdapter.cliName} Issue ID (leave blank to create one): `);
            if (inputIssueId) {
                try {
                    console.log(`🔍 Checking issue #${inputIssueId}...`);
                    const issueInfo = JSON.parse(gitUrlAdapter.issue.view(inputIssueId));
                    issueId = inputIssueId;
                    issueTitle = issueInfo.title;
                    console.log(`✅ Linked to: "${issueTitle}"`);
                } catch (err) {
                    console.error(`❌ Could not find issue #${inputIssueId}.`);
                    process.exit(1);
                }
            } else {
                const createIssue = await question("No Issue ID provided. Create a new feature request issue? (Y/n): ");
                if (createIssue.trim().toLowerCase() !== 'n') {
                    const title = await question("Enter issue title: ");
                    if (title) {
                        console.log("📝 Creating issue...");
                        try {
                            const newIssueUrl = gitUrlAdapter.issue.create(`[Feature]: ${title}`, `kind:enhancement,phase:sdd`, `Initiated via task:start`);
                            issueId = newIssueUrl.split('/').pop();
                            issueTitle = title;
                            console.log(`✅ Created issue #${issueId}: ${newIssueUrl}`);
                        } catch (err) {
                            console.error(`❌ Failed to create issue: ${err.message}`);
                            process.exit(1);
                        }
                    }
                }
            }
        }
    }

    if (phase === 'hotfix') {
        const name = await question("Enter hotfix name (e.g., auth-crash): ");
        if (!name) process.exit(1);

        const kebabName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const branchName = `hotfix/${kebabName}`;

        console.log(`\n🚀 Checking out ${branchName} from main...`);
        runCommand('git checkout main');
        runCommand('git pull origin main');
        runCommand(`git checkout -b ${branchName}`);
        console.log(`\n✅ Hotfix branch created. Run 'npm run task:finish' when done.`);
        process.exit(0);
    }

    // Feature Mode
    const typeOptions = ['feat', 'fix', 'refactor', 'chore', 'docs'];
    const type = await question(`Task type (${typeOptions.join('/')}) [feat]: `) || 'feat';
    if (!typeOptions.includes(type)) {
        console.error(`❌ Invalid type. Must be one of: ${typeOptions.join(', ')}`);
        process.exit(1);
    }

    let slug = '';
    if (issueTitle) {
        slug = issueTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
    } else {
        const manualName = await question("Enter task description (e.g., core-audit-logs): ");
        if (!manualName) process.exit(1);
        slug = manualName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    const branchName = issueId ? `${type}/${issueId}-${slug}` : `${type}/${slug}`;

    console.log(`\n🔄 Synchronizing main branch...`);
    runCommand('git checkout main');
    runCommand('git pull origin main');

    console.log(`🌱 Creating branch ${branchName}...`);
    runCommand(`git checkout -b ${branchName}`);

    // 4. Generate SDD Spec template
    const generateSpec = await question("\n📝 Do you want to initialize an SDD Feature Spec for this branch? (Y/n): ");
    if (generateSpec.trim().toLowerCase() !== 'n') {
        const specDir = path.join(process.cwd(), 'specs', 'features');
        fs.mkdirSync(specDir, { recursive: true });
        const specPath = path.join(specDir, `${slug}.md`);

        if (!fs.existsSync(specPath)) {
            const templatePath = path.join(process.cwd(), 'docs', 'templates', 'FEATURE_SPEC_TEMPLATE.md');
            let template = `# Feature Specification: ${issueTitle || slug}\n\n## 1. Problem Statement\n...\n`;
            if (fs.existsSync(templatePath)) {
                template = fs.readFileSync(templatePath, 'utf8').replace(/\{\{TITLE\}\}/g, issueTitle || slug);
            }
            fs.writeFileSync(specPath, template);
            console.log(`✅ Created SDD Spec Template at: ${specPath}`);
        } else {
            console.log(`⚠️ Spec already exists at: ${specPath}`);
        }
    }

    // 5. Generate ADR Document template
    const generateADR = await question("\n🏛️ Does this feature require an Architectural Decision Record (ADR)? (y/N): ");
    if (generateADR.trim().toLowerCase() === 'y') {
        const adrDir = path.join(process.cwd(), 'specs', 'ADRs');
        fs.mkdirSync(adrDir, { recursive: true });

        const files = fs.readdirSync(adrDir);
        const highestNumber = files
            .map(f => parseInt(f.match(/ADR-(\d+)/)?.[1] || '0', 10))
            .filter(n => !isNaN(n))
            .reduce((a, b) => Math.max(a, b), 0);

        const nextNumStr = String(highestNumber + 1).padStart(3, '0');
        const adrPath = path.join(adrDir, `ADR-${nextNumStr}-${slug}.md`);

        const templatePath = path.join(process.cwd(), 'docs', 'templates', 'ADR_TEMPLATE.md');
        let adrTemplate = `# ADR-${nextNumStr}: ${issueTitle || slug}\n\n## Context\n...\n`;
        if (fs.existsSync(templatePath)) {
            adrTemplate = fs.readFileSync(templatePath, 'utf8')
                .replace(/\{\{TITLE\}\}/g, issueTitle || slug)
                .replace(/\{\{NUMBER\}\}/g, nextNumStr);
        }

        fs.writeFileSync(adrPath, adrTemplate);
        console.log(`✅ Created ADR Template at: ${adrPath}`);
    }

    console.log(`\n🏁 Task Environment Ready! You are on branch: ${branchName}`);
    console.log(`Run 'npm run task:finish' when you're done with your BDD/TDD/DDD cycle.`);
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
