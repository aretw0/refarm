import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
	runAstro6To7Cli,
	scanAstro7UpgradeText,
	transformAstro6To7,
	transformAstro6To7WithReport,
} from "./astro-6-to-7.mjs";

test("astro 6 to 7 fixture updates app and peer manifest ranges", () => {
	const before = readFileSync(
		new URL("./fixtures/astro-6-to-7.before.json", import.meta.url),
		"utf8",
	);
	const after = readFileSync(
		new URL("./fixtures/astro-6-to-7.after.json", import.meta.url),
		"utf8",
	);

	assert.equal(transformAstro6To7(before), after);
	assert.deepEqual(
		{
			...transformAstro6To7WithReport(before),
			json: undefined,
		},
		{
			json: undefined,
			changed: true,
			astroRangesUpdated: 1,
			peerRangesWidened: 1,
			findings: [
				{
					code: "removed-astro-db",
					path: "dependencies.@astrojs/db",
					message:
						"@astrojs/db was removed in Astro 7; replace it before upgrading.",
				},
			],
		},
	);
});

test("astro 6 to 7 transform is idempotent", () => {
	const after = readFileSync(
		new URL("./fixtures/astro-6-to-7.after.json", import.meta.url),
		"utf8",
	);

	assert.equal(transformAstro6To7(after), after);
});

test("astro 6 to 7 transform preserves manifest text when no range changes", () => {
	const source = '{\n\t"dependencies": {\n\t\t"astro": "^7.0.3"\n\t}\n}\n';
	const result = transformAstro6To7WithReport(source);

	assert.equal(result.json, source);
	assert.equal(result.changed, false);
	assert.equal(result.astroRangesUpdated, 0);
	assert.equal(result.peerRangesWidened, 0);
});

test("astro 7 upgrade scanner reports review-only breakpoints", () => {
	const config = `import { defineConfig, logHandlers, memoryCache } from "astro/config";
import { getContainerRenderer } from "@astrojs/react";
import { TRANSITION_AFTER_SWAP, createAnimationScope } from "astro:transitions/client";

export default defineConfig({
  experimental: {
    logger: logHandlers.json({ pretty: true }),
    queuedRendering: { enabled: true },
    rustCompiler: true,
    advancedRouting: true,
    cache: { provider: memoryCache() },
    routeRules: { "/blog/[...path]": { maxAge: 300 } },
  },
});
`;

	assert.deepEqual(scanAstro7UpgradeText(config, { path: "astro.config.mjs" }), [
		{
			code: "removed-experimental-flag",
			path: "astro.config.mjs",
			message:
				"Astro 7 removes experimental.logger; move logger to the top-level config.",
		},
		{
			code: "removed-experimental-flag",
			path: "astro.config.mjs",
			message:
				"Astro 7 removes experimental.queuedRendering; queued rendering is now the default.",
		},
		{
			code: "removed-experimental-flag",
			path: "astro.config.mjs",
			message:
				"Astro 7 removes experimental.rustCompiler; the Rust compiler path is now stable/default.",
		},
		{
			code: "removed-experimental-flag",
			path: "astro.config.mjs",
			message:
				"Astro 7 removes experimental.advancedRouting; advanced routing is now enabled by default.",
		},
		{
			code: "removed-experimental-flag",
			path: "astro.config.mjs",
			message:
				"Astro 7 removes experimental.cache; move cache to the top-level config.",
		},
		{
			code: "removed-experimental-flag",
			path: "astro.config.mjs",
			message:
				"Astro 7 removes experimental.routeRules; move routeRules to the top-level config.",
		},
		{
			code: "deprecated-container-renderer-root-import",
			path: "astro.config.mjs",
			message:
				"Import getContainerRenderer from the integration container-renderer entrypoint.",
		},
		{
			code: "removed-transitions-internal",
			path: "astro.config.mjs",
			message:
				"Astro 7 removes deprecated astro:transitions internals; replace lifecycle constants/helpers.",
		},
	]);
	assert.deepEqual(scanAstro7UpgradeText("", { path: "src/fetch.ts" }), [
		{
			code: "reserved-src-fetch",
			path: "src/fetch.ts",
			message:
				"Astro 7 reserves src/fetch.ts and src/fetch.js for advanced routing; rename or configure fetchFile if this is not a route entrypoint.",
		},
	]);
});

test("astro 6 to 7 cli emits dry-run json and leaves files untouched", () => {
	const root = mkdtempSync(path.join(os.tmpdir(), "refarm-astro-codemod-"));
	const input = path.join(root, "package.json");
	const config = path.join(root, "astro.config.mjs");
	writeFileSync(
		input,
		'{\n  "dependencies": {\n    "astro": "^6.4.8"\n  }\n}\n',
		"utf8",
	);
	writeFileSync(
		config,
		'export default { experimental: { rustCompiler: true } };\n',
		"utf8",
	);
	let stdout = "";

	const status = runAstro6To7Cli(
		[
			"--input",
			input,
			"--scan",
			config,
			"--json",
		],
		{ stdout: { write: (chunk) => { stdout += chunk; } } },
	);

	assert.equal(status, 0);
	assert.deepEqual(JSON.parse(stdout), {
		input,
		changed: true,
		astroRangesUpdated: 1,
		peerRangesWidened: 0,
		findings: [
			{
				code: "removed-experimental-flag",
				path: config,
				message:
					"Astro 7 removes experimental.rustCompiler; the Rust compiler path is now stable/default.",
			},
		],
		written: false,
	});
	assert.equal(
		readFileSync(input, "utf8"),
		'{\n  "dependencies": {\n    "astro": "^6.4.8"\n  }\n}\n',
	);
});
