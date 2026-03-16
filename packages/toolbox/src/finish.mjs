import { execSync } from 'node:child_process';
import process from 'node:process';
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
            console.error(`\n❌ Command failed: ${command}`);
            process.exit(1);
        }
        return null;
    }
}

async function main() {
    console.log("🚜 Welcome to Refarm Developer Toolbox: Task Finish\n");

    // 1. Determine Current Branch Name
    const currentBranch = runCommand('git rev-parse --abbrev-ref HEAD', true, true);
    if (currentBranch === 'main' || currentBranch === 'develop') {
        console.error("❌ You are currently on the main or develop branch. Please checkout your feature branch.");
        process.exit(1);
    }

    // 1.1 Detect Issue ID from branch name: <type>/<issue-id>-<slug>
    const branchPattern = /^[^/]+\/(\d+)-.+$/;
    const match = currentBranch.match(branchPattern);
    const issueId = match ? match[1] : null;

    console.log(`📌 Completing task on branch: ${currentBranch}`);
    if (issueId) {
        console.log(`🔗 Detected linkage to Issue #${issueId}`);
    }

    // 2. Verify working directory has changes or commits
    const status = runCommand('git status --porcelain', false, true);
    const unpushed = runCommand(`git log origin/${currentBranch}..${currentBranch} --oneline`, false, true);

    if ((!status || status.length === 0) && (!unpushed || unpushed.length === 0)) {
        console.log("⚠️ No changes or unpushed commits detected. Nothing to finish.");
        process.exit(0);
    }

    // 3. Run Verification Pipeline
    console.log("\n🔍 Running strict verification pipeline before finishing...");
    const verifyPath = path.join(__dirname, 'verify.mjs');
    runCommand(`node ${verifyPath}`);

    // 4. Generate Changeset if needed
    console.log("\n📦 Running Changeset CLI to document your work (Answer the prompts)...");
    try {
        runCommand('npm run changeset');
    } catch (err) {
        console.error("⚠️ Changeset generation skipped or failed. Be careful, a changeset is required for production patches.");
    }

    // 5. Commit all changes automatically if not committed
    if (status && status.length > 0) {
        const autoCommit = await question("\n💻 You have unstaged changes. Commit and Push? (Y/n): ");
        if (autoCommit.trim().toLowerCase() !== 'n') {
            const branchParts = currentBranch.split('/');
            const type = branchParts[0] || 'feat';
            const desc = branchParts[1] ? branchParts[1].replace(/-/g, ' ').replace(/^\d+-/, '') : 'updates';

            const commitMsg = `${type}: finish ${desc}`;
            console.log(`\n💾 Committing changes: "${commitMsg}"`);
            runCommand('git add .');
            runCommand(`git commit -m "${commitMsg}"`, false);
        }
    }

    // 6. Push to origin
    console.log(`\n🚀 Pushing to origin ${currentBranch}...`);
    runCommand(`git push -u origin ${currentBranch}`);

    // 7. Open PR suggestion
    console.log("\n🎉 Verification and Push complete!");

    const openPR = await question(`\n🌐 Open Pull Request on ${gitUrlAdapter.cliName}? (Y/n): `);

    try {
        const prCommand = gitUrlAdapter.pr.createCommand(issueId);

        if (openPR.trim().toLowerCase() !== 'n') {
            const prTitle = issueId ? `finish: work on #${issueId}` : `feat: merge ${currentBranch.split('/').pop()}`;
            const fullCommand = `${prCommand} --title "${prTitle}" --fill`;
            console.log(`\n🚀 running: ${fullCommand}`);
            runCommand(fullCommand);
        } else {
            console.log(`\n💡 You can open the PR later with:\n   ${prCommand} --title "..."`);
        }
    } catch (err) {
        console.log(`\n⚠️ Failed to prepare PR command: ${err.message}. You can do it manually.`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
