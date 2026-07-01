import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function read(path) {
	return readFileSync(path, "utf8");
}

function readJson(path) {
	return JSON.parse(read(path));
}

test("deploy-dev workflow keeps GitHub Pages deploy gated by site build smoke", () => {
	const workflow = read(".github/workflows/deploy-dev.yml");
	const uploadAction = read(".github/actions/upload-pages/action.yml");
	const deployAction = read(".github/actions/deploy-pages/action.yml");

	assert.match(workflow, /name: Deploy to Refarm\.dev/);
	assert.match(workflow, /branches: \[main, master\]/);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup\n\s+with:\n\s+cache-mode: "off"/);
	assert.match(workflow, /apps\/site\/\*\*/);
	assert.doesNotMatch(workflow, /apps\/dev\/\*\*/);
	assert.doesNotMatch(workflow, /REFARM_SCOPE_DEV\/heartwood/);
	assert.match(workflow, /run: pnpm --filter "\$REFARM_SCOPE_DEV\/site" run test/);
	assert.match(workflow, /run: pnpm --filter "\$REFARM_SCOPE_DEV\/site" run build/);
	assert.match(workflow, /ASTRO_SITE: \$\{\{ vars\.REFARM_ASTRO_SITE \|\| format\('https:\/\/\{0\}\.github\.io\/\{1\}\/', github\.repository_owner, github\.event\.repository\.name\) \}\}/);
	assert.match(workflow, /ASTRO_BASE: \$\{\{ vars\.REFARM_ASTRO_BASE \|\| format\('\/\{0\}\/', github\.event\.repository\.name\) \}\}/);
	assert.match(workflow, /run: node scripts\/ci\/check-astro-base-links\.mjs apps\/site\/dist "\$ASTRO_BASE"/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/upload-pages\n\s+with:\n\s+path: apps\/site\/dist/);
	assert.match(workflow, /deploy:\n\s+environment:\n\s+name: github-pages\n\s+url: \$\{\{ steps\.deployment\.outputs\.page_url \}\}\n\s+needs: build/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/deploy-pages/);
	assert.match(uploadAction, /uses: actions\/upload-pages-artifact@[0-9a-f]{40}/);
	assert.match(deployAction, /uses: actions\/deploy-pages@[0-9a-f]{40}/);
	assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|changeset publish|pnpm publish|npm publish/);
});

test("release workflow keeps package publishing opt-in and provenance-scoped", () => {
	const packageJson = readJson("package.json");
	const changesetConfig = readJson(".changeset/config.json");
	const workflow = read(".github/workflows/release-changesets.yml");

	assert.equal(packageJson.private, true);
	assert.equal(packageJson.scripts["release:check"], "node scripts/release-check.mjs");
	assert.equal(changesetConfig.access, "public");
	assert.equal(changesetConfig.baseBranch, "main");
	assert.match(workflow, /name: Release \(Changesets\)/);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /permissions:\n\s+contents: write\n\s+pull-requests: write\n\s+id-token: write/);
	assert.match(workflow, /if: vars\.RELEASE_AUTOMATION == 'true'/);
	assert.match(workflow, /vars\.RELEASE_OWNER == '' \|\| github\.repository_owner == vars\.RELEASE_OWNER/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup\n\s+with:\n\s+cache-mode: "off"/);
	assert.match(workflow, /pnpm run runtime-descriptor:release-smoke -- --sha "\$\{\{ github\.sha \}\}"/);
	assert.match(workflow, /id: first-publish-guard/);
	assert.match(workflow, /node scripts\/ci\/check-first-publish-changesets\.mjs --selection vault-seed-ready --soft/);
	assert.match(workflow, /if: steps\.first-publish-guard\.outputs\.blocked == 'true'/);
	assert.match(workflow, /if: steps\.first-publish-guard\.outputs\.blocked != 'true'/);
	assert.match(workflow, /uses: changesets\/action@[0-9a-f]{40}/);
	assert.match(workflow, /publish: changeset publish/);
	assert.match(workflow, /NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
	assert.match(workflow, /if: steps\.changesets\.outputs\.published == 'true'/);
	assert.match(workflow, /publish-runtime-descriptor-release-assets\.mjs --bundle-dir \.artifacts\/runtime-descriptors --sha "\$\{\{ github\.sha \}\}"/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
	assert.doesNotMatch(workflow, /npm\.pkg\.github\.com|packages:\s*write/);
});

test("first-publish workflow publishes 0.1.0 only through explicit manual confirmation", () => {
	const workflow = read(".github/workflows/first-publish-vault-seed.yml");

	assert.match(workflow, /name: First Publish Vault Seed Ready/);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /dry_run:/);
	assert.match(workflow, /default: "true"/);
	assert.match(workflow, /confirm:/);
	assert.match(workflow, /permissions:\n\s+contents: read\n\s+id-token: write/);
	assert.match(workflow, /if: vars\.RELEASE_AUTOMATION == 'true'/);
	assert.match(workflow, /vars\.RELEASE_OWNER == '' \|\| github\.repository_owner == vars\.RELEASE_OWNER/);
	assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/);
	assert.match(workflow, /pnpm --silent run release:vault-seed:check/);
	assert.match(workflow, /if: inputs\.dry_run == 'true'\n\s+run: pnpm --silent run release:vault-seed:first-publish -- --plan --json/);
	assert.match(workflow, /REFARM_FIRST_PUBLISH_CONFIRM: \$\{\{ inputs\.confirm \}\}/);
	assert.match(workflow, /test "\$REFARM_FIRST_PUBLISH_CONFIRM" = "publish-vault-seed-ready-0\.1\.0"/);
	assert.match(workflow, /if: inputs\.dry_run == 'false'\n\s+run: echo "\/\/registry\.npmjs\.org\/:_authToken=\$\{\{ secrets\.NPM_TOKEN \}\}" > ~\/\.npmrc/);
	assert.match(workflow, /pnpm --silent run release:vault-seed:first-publish -- --publish --confirm "\$REFARM_FIRST_PUBLISH_CONFIRM"/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
	assert.doesNotMatch(workflow, /packages:\s*write/);
});

test("develop sync workflow does not rewrite atomic history after squash releases", () => {
	const workflow = read(".github/workflows/sync-develop.yml");

	assert.match(workflow, /name: Sync develop ← main/);
	assert.match(workflow, /git merge --ff-only "\$main_ref"/);
	assert.match(workflow, /status=tree-equivalent-history-diverged/);
	assert.match(workflow, /automatic reset is disabled to preserve atomic develop history/);
	assert.match(workflow, /apagaria a rastreabilidade dos commits\s+atômicos mantidos em `develop`/);
	assert.doesNotMatch(workflow, /git push --force-with-lease origin develop/);
	assert.doesNotMatch(workflow, /status=tree-equivalent-reset/);
});
