import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const helper = resolve("scripts/model-provider.sh");

function makeRoot() {
	const root = mkdtempSync(join(tmpdir(), "refarm-model-provider-root-"));
	mkdirSync(join(root, "packages/config/src"), { recursive: true });
	writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module" }));
	writeFileSync(
		join(root, "packages/config/src/model-routing.js"),
		"export const DEFAULT_MODEL_PROVIDER = 'openai';\n",
	);
	return root;
}

function makeHome() {
	const home = mkdtempSync(join(tmpdir(), "refarm-model-provider-home-"));
	mkdirSync(join(home, ".refarm"), { recursive: true });
	return home;
}

function resolveProvider(root, env = {}) {
	return execFileSync(
		"sh",
		[
			"-c",
			`. '${helper}'; resolve_refarm_model_provider "$1"`,
			"resolve-provider",
			root,
		],
		{
			encoding: "utf8",
			env: {
				PATH: process.env.PATH,
				HOME: env.HOME,
				MODEL_PROVIDER: env.MODEL_PROVIDER,
				MODEL_DEFAULT_PROVIDER: env.MODEL_DEFAULT_PROVIDER,
				REFARM_OPERATOR_IDENTITY_FILE: env.REFARM_OPERATOR_IDENTITY_FILE,
			},
		},
	);
}

test("runtime start helpers prefer explicit MODEL_PROVIDER", () => {
	const root = makeRoot();
	try {
		assert.equal(resolveProvider(root, { MODEL_PROVIDER: "gemini" }), "gemini");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("runtime start helpers prefer workspace config over operator identity", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		mkdirSync(join(root, ".refarm"), { recursive: true });
		writeFileSync(
			join(root, ".refarm/config.json"),
			JSON.stringify({ modelProvider: "anthropic" }),
		);
		writeFileSync(
			join(home, ".refarm/identity.json"),
			JSON.stringify({ modelProvider: "ollama" }),
		);

		assert.equal(resolveProvider(root, { HOME: home }), "anthropic");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("runtime start helpers read operator identity written by sow", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		writeFileSync(
			join(home, ".refarm/identity.json"),
			JSON.stringify({ modelProvider: "ollama", modelId: "llama3.2" }),
		);

		assert.equal(resolveProvider(root, { HOME: home }), "ollama");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("runtime start helpers infer provider from a default model route", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		writeFileSync(
			join(home, ".refarm/identity.json"),
			JSON.stringify({ modelRoutes: { default: "ollama/llama3.2" } }),
		);

		assert.equal(resolveProvider(root, { HOME: home }), "ollama");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});

test("runtime start helpers fall back to shared default provider", () => {
	const root = makeRoot();
	const home = makeHome();
	try {
		assert.equal(resolveProvider(root, { HOME: home }), "openai");
	} finally {
		rmSync(root, { recursive: true, force: true });
		rmSync(home, { recursive: true, force: true });
	}
});
