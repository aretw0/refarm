
// Minimal implementation block to avoid massive dependencies if possible,
// Assuming we run `npm ci` so we have whatever is in the repository.
// We'll use the native Node 'https' if octokit isn't available, but since this runs
// after `npm ci` and `@actions/github` might not be in root package.json natively,
// let's use a pure fetch approach since Node 20 supports it.

const token = process.env.GITHUB_TOKEN;
const payloadStr = process.env.ISSUE_PAYLOAD;
const repository = process.env.REPOSITORY; // format: "owner/repo"

if (!token || !payloadStr || !repository) {
    console.error("Missing required environment variables (GITHUB_TOKEN, ISSUE_PAYLOAD, REPOSITORY).");
    process.exit(1);
}

const issue = JSON.parse(payloadStr);
const title = issue.title.toLowerCase();
const body = (issue.body || "").toLowerCase();
const issueNumber = issue.number;
const userLogin = issue.user?.login || "";

// Handle automated bot issues
let isAutomated = false;
let isDependabot = false;

if (userLogin === "github-actions[bot]") {
    console.log(`🤖 Detected automated issue #${issueNumber} from CI/CD.`);
    isAutomated = true;
} else if (userLogin === "dependabot[bot]") {
    console.log(`📦 Detected automated PR/Issue #${issueNumber} from Dependency updates (Bot).`);
    isDependabot = true;
}

// Rules dictionary: if Keyword exists in Title/Body -> Apply these labels
const RULES = [
    { keywords: ['[bug]', 'bug', 'crash', 'panic', 'error'], labels: ['kind:bug', 'needs:triage'] },
    { keywords: ['[feature]', 'feature', 'enhancement', 'idea'], labels: ['kind:enhancement', 'phase:sdd'] },
    { keywords: ['tractor', 'engine', 'kernel', 'storage', 'crdt'], labels: ['area:kernel'] },
    { keywords: ['homestead', 'ui', 'shell', 'dashboard', 'studio'], labels: ['area:ui'] },
    { keywords: ['plugin', 'antenna', 'extension'], labels: ['area:plugin'] },
    { keywords: ['nostr', 'identity', 'auth', 'keys'], labels: ['area:identity'] },
    { keywords: ['documentation', 'docs', 'readme', 'validation failed'], labels: ['kind:docs'] },
    { keywords: ['dependency', 'bump', 'update', 'vulnerability'], labels: ['area:dependencies'] }
];

async function run() {
    console.log(`🔍 Triaging Issue #${issueNumber}: "${issue.title}"`);

    const labelsToAdd = new Set();

    for (const rule of RULES) {
        for (const keyword of rule.keywords) {
            if (title.includes(keyword) || body.includes(keyword)) {
                rule.labels.forEach(label => labelsToAdd.add(label));
            }
        }
    }

    if (isAutomated) {
        labelsToAdd.add('automated');
    }
    if (isDependabot) {
        labelsToAdd.add('dependencies');
    }

    if (labelsToAdd.size === 0 && !isAutomated && !isDependabot) {
        labelsToAdd.add('needs:triage');
        console.log("⚠️ No specific keywords found. Applying default 'needs:triage'.");
    }

    const newLabels = Array.from(labelsToAdd);
    console.log(`🏷️ Labels to apply: ${newLabels.join(', ')}`);

    // We use Fetch API (available in Node 20) to hit the GitHub REST API directly
    // This avoids forcing the monorepo to install @actions/github just for this script.
    const apiUrl = `https://api.github.com/repos/${repository}/issues/${issueNumber}/labels`;

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'Refarm-Triage-Bot'
        },
        body: JSON.stringify({
            labels: newLabels
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to add labels. Status: ${response.status} ${response.statusText}`);
        console.error(`Response: ${errorText}`);
        process.exit(1);
    }

    console.log("✅ Successfully applied labels!");
}

run().catch(error => {
    console.error("❌ Unexpected error during triage:", error);
    process.exit(1);
});
