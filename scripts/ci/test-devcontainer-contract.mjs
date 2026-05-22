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

test("post-start does not rely on USER being set", () => {
	const content = readFileSync(".devcontainer/post-start.sh", "utf8");
	assert.doesNotMatch(content, /\$USER/);
	assert.match(content, /\$\{USER:-\$\(id -un\)\}/);
});