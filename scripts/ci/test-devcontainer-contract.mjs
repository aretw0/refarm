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

test("devcontainer keeps npm cache writable and persistent", () => {
	const config = readJson(".devcontainer/devcontainer.json");
	const postCreate = readFileSync(".devcontainer/post-create.sh", "utf8");
	const postStart = readFileSync(".devcontainer/post-start.sh", "utf8");
	const farm = readFileSync(".devcontainer/farm", "utf8");

	assert.equal(config.containerEnv.NPM_CONFIG_CACHE, "/workspaces/refarm/.cache/npm");
	assert.equal(config.containerEnv.REFARM_DEVCONTAINER, "true");
	assert.ok(
		!config.mounts.some((mount) => mount.includes("target=/home/vscode/.npm-cache")),
		"npm cache must stay in the writable workspace cache, not a home mount that agent sandboxes may expose read-only",
	);
	assert.match(postCreate, /export NPM_CONFIG_CACHE="\$\{NPM_CONFIG_CACHE:-\$ROOT\/\.cache\/npm\}"/);
	assert.match(postCreate, /export REFARM_DEVCONTAINER="\$\{REFARM_DEVCONTAINER:-true\}"/);
	assert.match(postCreate, /"\$NPM_CONFIG_CACHE"/);
	assert.match(postStart, /export NPM_CONFIG_CACHE="\$\{NPM_CONFIG_CACHE:-\$ROOT\/\.cache\/npm\}"/);
	assert.match(postStart, /export REFARM_DEVCONTAINER="\$\{REFARM_DEVCONTAINER:-true\}"/);
	assert.match(postStart, /repair_owned_dir "\$NPM_CONFIG_CACHE"/);
	assert.match(farm, /export NPM_CONFIG_CACHE=\$\{PROJECT_DIR\}\/\.cache\/npm/);
	assert.match(farm, /export REFARM_DEVCONTAINER=true/);
});

test("devcontainer keeps runtime mutable state inside the workspace", () => {
	const config = readJson(".devcontainer/devcontainer.json");
	const postCreate = readFileSync(".devcontainer/post-create.sh", "utf8");
	const postStart = readFileSync(".devcontainer/post-start.sh", "utf8");
	const farm = readFileSync(".devcontainer/farm", "utf8");
	const tractorStart = readFileSync("scripts/tractor-start.sh", "utf8");

	assert.equal(config.containerEnv.REFARM_HOME, "/workspaces/refarm/.refarm");
	assert.equal(config.containerEnv.XDG_DATA_HOME, "/workspaces/refarm/.refarm/data");
	assert.equal(config.containerEnv.REFARM_STREAMS_DIR, "/workspaces/refarm/.refarm/streams");
	assert.ok(
		!config.mounts.some((mount) => mount.includes("target=/home/vscode/.refarm")),
		"Refarm mutable state must stay under REFARM_HOME in the workspace, not a home volume",
	);
	assert.match(postCreate, /export REFARM_HOME="\$\{REFARM_HOME:-\$ROOT\/\.refarm\}"/);
	assert.match(postCreate, /export XDG_DATA_HOME="\$\{XDG_DATA_HOME:-\$REFARM_HOME\/data\}"/);
	assert.match(postCreate, /export REFARM_STREAMS_DIR="\$\{REFARM_STREAMS_DIR:-\$REFARM_HOME\/streams\}"/);
	assert.doesNotMatch(postCreate, /\/home\/vscode\/\.refarm/);
	assert.match(postStart, /repair_owned_dir "\$REFARM_HOME"/);
	assert.match(postStart, /repair_owned_dir "\$XDG_DATA_HOME"/);
	assert.match(postStart, /repair_owned_dir "\$REFARM_STREAMS_DIR"/);
	assert.match(farm, /export REFARM_HOME=\$\{PROJECT_DIR\}\/\.refarm/);
	assert.match(farm, /export XDG_DATA_HOME=\$\{REFARM_HOME\}\/data/);
	assert.match(farm, /export REFARM_STREAMS_DIR=\$\{REFARM_HOME\}\/streams/);
	assert.match(tractorStart, /REFARM_HOME="\$\{REFARM_HOME:-\$ROOT\/\.refarm\}"/);
	assert.match(tractorStart, /XDG_DATA_HOME="\$\{XDG_DATA_HOME:-\$REFARM_HOME\/data\}"/);
	assert.match(tractorStart, /REFARM_STREAMS_DIR="\$\{REFARM_STREAMS_DIR:-\$REFARM_HOME\/streams\}"/);
	assert.match(tractorStart, /INSTALLED_AGENT_PLUGIN="\$REFARM_HOME\/plugins\/@refarm\/pi-agent\/plugin\.wasm"/);
	assert.ok(!tractorStart.includes(["INSTALLED", "PI", "AGENT"].join("_")));
	assert.doesNotMatch(tractorStart, /\$HOME\/\.refarm\/plugins/);
	assert.match(tractorStart, /--refarm-dir "\$REFARM_HOME"/);
	assert.match(tractorStart, /export REFARM_HOME/);
	assert.match(tractorStart, /export XDG_DATA_HOME/);
});

test("devcontainer keeps Rust target artifacts inside the workspace cache", () => {
	const config = readJson(".devcontainer/devcontainer.json");
	const cargoConfig = readFileSync(".cargo/config.toml", "utf8");
	const postCreate = readFileSync(".devcontainer/post-create.sh", "utf8");
	const farm = readFileSync(".devcontainer/farm", "utf8");

	assert.equal(config.containerEnv.CARGO_TARGET_DIR, "/workspaces/refarm/.cache/cargo-target");
	assert.ok(
		!config.mounts.some((mount) => mount.includes("target=/home/vscode/.cargo-target")),
		"Cargo target must stay in the writable workspace cache, not a home mount that agent sandboxes may expose read-only",
	);
	assert.match(cargoConfig, /target-dir = "\/workspaces\/refarm\/\.cache\/cargo-target"/);
	assert.match(postCreate, /"\$CARGO_TARGET_DIR"/);
	assert.match(farm, /export CARGO_TARGET_DIR=\$\{PROJECT_DIR\}\/\.cache\/cargo-target/);
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
