import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const guardScript = path.join(repoRoot, "scripts/ci/tsconfig-guard.mjs");

function writeJson(file, value) {
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

test("tsconfig guard fallback honors inherited node types", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-tsconfig-guard-"));
	try {
		mkdirSync(path.join(root, "packages/tsconfig"), { recursive: true });
		mkdirSync(path.join(root, "apps/demo/src"), { recursive: true });

		writeJson(path.join(root, "packages/tsconfig/base.json"), {
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
				ignoreDeprecations: "6.0",
			},
		});
		writeJson(path.join(root, "packages/tsconfig/node.json"), {
			extends: "./base.json",
			compilerOptions: {
				types: ["node"],
			},
		});
		writeJson(path.join(root, "apps/demo/package.json"), {
			scripts: {
				"type-check": "tsc --noEmit",
			},
		});
		writeJson(path.join(root, "apps/demo/tsconfig.json"), {
			extends: "@refarm.dev/tsconfig/node.json",
			compilerOptions: {
				noEmit: true,
			},
			include: ["src/**/*"],
		});
		writeFileSync(
			path.join(root, "apps/demo/src/index.ts"),
			'import { readFileSync } from "node:fs";\nexport { readFileSync };\n',
		);

		const result = spawnSync(process.execPath, [guardScript], {
			cwd: root,
			env: {
				...process.env,
				REFARM_TSCONFIG_GUARD_FORCE_FALLBACK: "1",
			},
			encoding: "utf8",
		});

		assert.equal(result.status, 0, result.stderr || result.stdout);
		assert.match(result.stdout, /TSConfig guard: OK \(1 projects scanned\)/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
