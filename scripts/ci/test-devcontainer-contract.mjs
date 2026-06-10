import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

test("devcontainer publishes operator-facing local services", () => {
	const config = readJson(".devcontainer/devcontainer.json");
	const expectedPorts = [4321, 42000, 42001, 1455, 53692];

	assert.deepEqual(config.forwardPorts, expectedPorts);
	for (const port of expectedPorts) {
		assert.ok(
			config.runArgs.includes(`127.0.0.1:${port}:${port}`),
			`missing explicit host publish for ${port}`,
		);
		assert.equal(config.portsAttributes[String(port)].onAutoForward, "silent");
	}
	assert.ok(config.portsAttributes["4321"].label.includes("Astro"));
	assert.ok(config.portsAttributes["42000"].label.includes("WebSocket"));
	assert.ok(config.portsAttributes["42001"].label.includes("HTTP"));
});
test("keeps devcontainer shell scripts LF-only", () => {
	for (const path of [".devcontainer/post-create.sh", ".devcontainer/post-start.sh", ".devcontainer/farm"]) {
		const content = readFileSync(path, "utf8");
		assert.equal(content.includes("\r"), false, `${path} must stay LF-only for bash in Linux containers`);
	}
});

test("devcontainer isolates node_modules from the host platform", () => {
	const config = readJson(".devcontainer/devcontainer.json");
	assert.ok(
		config.mounts.includes("source=refarm-node-modules,target=/workspaces/refarm/node_modules,type=volume"),
		"node_modules must be container-owned so Windows and Linux do not share package-manager shims",
	);
});

test("post-start does not rely on USER being set", () => {
	const content = readFileSync(".devcontainer/post-start.sh", "utf8");
	assert.doesNotMatch(content, /\$USER/);
	assert.match(content, /\$\{USER:-\$\(id -un\)\}/);
});

test("post-start warns when gh auth is stored under root instead of the persisted dev user", () => {
	const content = readFileSync(".devcontainer/post-start.sh", "utf8");
	assert.match(content, /check_gh_auth_home\(\)/);
	assert.match(content, /\/root\/\.config\/gh/);
	assert.match(content, /\/home\/vscode\/\.config\/gh/);
	assert.match(content, /farm vscode \/workspaces\/refarm gh auth login/);
});

test("devcontainer exposes refarm through the intentional farm user shell", () => {
	const farm = readFileSync(".devcontainer/farm", "utf8");
	const postCreate = readFileSync(".devcontainer/post-create.sh", "utf8");
	const postStart = readFileSync(".devcontainer/post-start.sh", "utf8");

	assert.match(postCreate, /cli:install/);
	assert.match(postStart, /ensure_refarm_cli\(\)/);
	assert.match(farm, /export HOME=\/home\/\$\{TARGET_USER\}/);
	assert.match(farm, /export PNPM_HOME=\/home\/\$\{TARGET_USER\}\/\.local\/share\/pnpm/);
	assert.match(farm, /\/home\/\$\{TARGET_USER\}\/\.local\/bin/);
	assert.match(farm, /\/home\/\$\{TARGET_USER\}\/\.npm-global\/bin/);
	assert.match(farm, /exec su -s \/bin\/bash "\$TARGET_USER" -- -lc/);
});

test("devcontainer provides the baseline sandbox tools expected by agents", () => {
	const config = readJson(".devcontainer/devcontainer.json");
	const dockerfile = readFileSync(".devcontainer/Dockerfile", "utf8");
	const postStart = readFileSync(".devcontainer/post-start.sh", "utf8");

	assert.deepEqual(config.features["ghcr.io/jsburckhardt/devcontainer-features/uv:1"], {});

	for (const packageName of [
		"bash-completion",
		"bubblewrap",
		"fd-find",
		"git-lfs",
		"hyperfine",
		"jq",
		"ripgrep",
		"shellcheck",
		"shfmt",
		"tree",
		"unzip",
	]) {
		assert.match(dockerfile, new RegExp(`\\b${packageName}\\b`), `${packageName} must be installed in the devcontainer image`);
	}

	assert.match(dockerfile, /ln -sf \/usr\/bin\/fdfind \/usr\/local\/bin\/fd/);
	assert.match(postStart, /check_coding_agent_tools\(\)/);
	assert.match(postStart, /for tool in bwrap fd rg jq shellcheck shfmt pi; do/);
	assert.match(postStart, /Missing coding-agent tools/);
});
