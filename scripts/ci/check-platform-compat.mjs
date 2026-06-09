#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
	["node", ["scripts/ci/check-node-substrate.mjs", "--json"]],
	["node", ["scripts/ci/check-rust-substrate.mjs", "--json"]],
	["node", ["scripts/ci/run-workspace-script.mjs", "--with-dependency-builds", "packages/cli", "build"]],
	["node", ["scripts/ci/run-workspace-script.mjs", "--with-dependency-builds", "apps/refarm", "build"]],
	[
		"node",
		[
			"scripts/ci/run-workspace-script.mjs",
			"--with-dependency-builds",
			"packages/cli",
			"test",
			"--",
			"operator-resume.test.ts",
			"command-handoff.test.ts",
		],
	],
];

for (const [command, args] of commands) {
	const display = [command, ...args].join(" ");
	console.log(`[platform-compat] ${display}`);
	const result = spawnSync(command, args, {
		stdio: "inherit",
		env: {
			...process.env,
			CI: process.env.CI ?? "true",
		},
		windowsHide: true,
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}
