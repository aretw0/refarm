import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function read(path) {
	return readFileSync(path, "utf8");
}

function readJson(path) {
	return JSON.parse(read(path));
}

test("deploy-dev workflow keeps GitHub Pages deploy gated by build smoke", () => {
	const workflow = read(".github/workflows/deploy-dev.yml");
	const uploadAction = read(".github/actions/upload-pages/action.yml");
	const deployAction = read(".github/actions/deploy-pages/action.yml");

	assert.match(workflow, /name: Deploy to Refarm\.dev/);
	assert.match(workflow, /branches: \[main, master\]/);
	assert.match(workflow, /workflow_dispatch:/);
	assert.match(workflow, /permissions:\n\s+contents: read\n\s+pages: write\n\s+id-token: write/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/setup\n\s+with:\n\s+cache-mode: "off"/);
	assert.match(workflow, /run: pnpm --filter "\$REFARM_SCOPE_DEV\/heartwood" run build/);
	assert.match(workflow, /run: pnpm --filter "\$REFARM_SCOPE_DEV\/app" run build/);
	assert.match(workflow, /ASTRO_SITE: \$\{\{ vars\.REFARM_ASTRO_SITE \|\| format\('https:\/\/\{0\}\.github\.io\/\{1\}\/', github\.repository_owner, github\.event\.repository\.name\) \}\}/);
	assert.match(workflow, /ASTRO_BASE: \$\{\{ vars\.REFARM_ASTRO_BASE \|\| format\('\/\{0\}\/', github\.event\.repository\.name\) \}\}/);
	assert.match(workflow, /run: node scripts\/ci\/check-astro-base-links\.mjs apps\/dev\/dist "\$ASTRO_BASE"/);
	assert.match(workflow, /uses: \.\/\.github\/actions\/upload-pages\n\s+with:\n\s+path: apps\/dev\/dist/);
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
	assert.match(workflow, /uses: changesets\/action@[0-9a-f]{40}/);
	assert.match(workflow, /publish: changeset publish/);
	assert.match(workflow, /NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/);
	assert.match(workflow, /if: steps\.changesets\.outputs\.published == 'true'/);
	assert.match(workflow, /publish-runtime-descriptor-release-assets\.mjs --bundle-dir \.artifacts\/runtime-descriptors --sha "\$\{\{ github\.sha \}\}"/);
	assert.doesNotMatch(workflow, /pull_request_target:/);
	assert.doesNotMatch(workflow, /npm\.pkg\.github\.com|packages:\s*write/);
});
