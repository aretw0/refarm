#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

import { buildScaffoldInventory } from "./lib/scaffold-inventory.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

async function loadGeneratorConfig() {
	const sourcePath = join(ROOT, "turbo/generators/config.ts");
	const outDir = mkdtempSync(join(tmpdir(), "refarm-turbo-generator-"));
	const outPath = join(outDir, "config.mjs");
	try {
		const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
			compilerOptions: {
				module: ts.ModuleKind.ES2022,
				target: ts.ScriptTarget.ES2022,
				verbatimModuleSyntax: true,
			},
			fileName: sourcePath,
		});
		writeFileSync(outPath, transpiled.outputText);
		const imported = await import(`file://${outPath}?t=${Date.now()}`);
		return { configure: imported.default, cleanup: () => rmSync(outDir, { force: true, recursive: true }) };
	} catch (error) {
		rmSync(outDir, { force: true, recursive: true });
		throw error;
	}
}

async function configuredGenerators() {
	const generators = new Map();
	const { configure, cleanup } = await loadGeneratorConfig();
	try {
		configure({
			setGenerator(name, definition) {
				generators.set(name, definition);
			},
		});
		return generators;
	} finally {
		cleanup();
	}
}

function render(template, values) {
	return Object.entries(values).reduce(
		(content, [key, value]) => content.replaceAll(`{{${key}}}`, String(value)),
		template,
	);
}

function listFiles(dir) {
	const files = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listFiles(fullPath));
			continue;
		}
		files.push(fullPath);
	}
	return files.sort();
}

function outputPathForTemplate(relativePath, values) {
	const renderedPath = render(relativePath, values);
	return renderedPath.endsWith(".hbs") ? renderedPath.slice(0, -4) : renderedPath;
}

function toPosixPath(value) {
	return value.split(/[\\/]/).join("/");
}

async function materializeGeneratorWorkspace(root, generator, data) {
	assert.ok(generator, "expected generator to exist");
	const actions = generator.actions(data);
	for (const action of actions) {
		if (action.type !== "addMany") continue;
		const sourceDir = join(ROOT, "turbo/generators", action.base);
		const destinationDir = join(root, render(action.destination, data));
		for (const templateFile of listFiles(sourceDir)) {
			const templateRelativePath = relative(sourceDir, templateFile);
			const outputRelativePath = outputPathForTemplate(templateRelativePath, data);
			const outputPath = join(destinationDir, outputRelativePath);
			mkdirSync(dirname(outputPath), { recursive: true });
			writeFileSync(outputPath, render(readFileSync(templateFile, "utf8"), data));
		}
	}
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function assertFileExists(root, relativePath, message) {
	assert.ok(existsSync(join(root, relativePath)), message ?? `${relativePath} should exist`);
}

function assertAnyGeneratedFile(itemDir, predicate, message) {
	const files = listFiles(itemDir).map((file) => toPosixPath(relative(itemDir, file)));
	assert.ok(files.some(predicate), message);
}

function assertNoTemplatePlaceholders(itemDir, itemPath) {
	for (const file of listFiles(itemDir)) {
		const relativeFile = toPosixPath(relative(itemDir, file));
		assert.equal(
			relativeFile.includes("{{"),
			false,
			`${itemPath}/${relativeFile} should not leave template markers in the file name`,
		);
		assert.equal(
			readFileSync(file, "utf8").includes("{{"),
			false,
			`${itemPath}/${relativeFile} should not leave unrendered template markers`,
		);
	}
}

function distEntrypointSource(distPath) {
	const normalized = toPosixPath(distPath).replace(/^\.\//, "");
	if (!normalized.startsWith("dist/")) return null;
	return `src/${normalized.slice("dist/".length).replace(/\.[cm]?js$/, ".ts")}`;
}

function assertBuiltEntrypointHasSource(itemDir, entrypoint, itemPath) {
	const sourcePath = distEntrypointSource(entrypoint);
	if (!sourcePath) return;
	assertFileExists(
		itemDir,
		sourcePath,
		`${itemPath} exposes ${entrypoint}, but ${sourcePath} is missing`,
	);
}

function scriptTokens(script) {
	return script
		.split(/\s+/)
		.map((token) => token.replace(/^['"]|['"]$/g, ""))
		.filter(Boolean);
}

function extractNodeTargets(script) {
	const tokens = scriptTokens(script);
	const targets = [];
	for (let index = 0; index < tokens.length; index += 1) {
		if (tokens[index] !== "node") continue;
		let cursor = index + 1;
		while (cursor < tokens.length && tokens[cursor].startsWith("-")) cursor += 1;
		if (cursor < tokens.length) targets.push(tokens[cursor]);
	}
	return targets;
}

function globPatternToRegExp(pattern) {
	const escaped = toPosixPath(pattern)
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replaceAll("*", "[^/]*");
	return new RegExp(`^${escaped}$`);
}

function assertLocalNodeTarget(itemDir, itemPath, target) {
	const normalized = toPosixPath(target).replace(/^\.\//, "");
	if (normalized.startsWith("../")) return;
	const sourcePath = distEntrypointSource(normalized);
	if (sourcePath) {
		assertFileExists(
			itemDir,
			sourcePath,
			`${itemPath} runs ${target}, but ${sourcePath} is missing`,
		);
		return;
	}
	if (normalized.includes("*")) {
		const matcher = globPatternToRegExp(normalized);
		assertAnyGeneratedFile(
			itemDir,
			(file) => matcher.test(file),
			`${itemPath} runs ${target}, but no generated file matches it`,
		);
		return;
	}
	assertFileExists(itemDir, normalized, `${itemPath} runs ${target}, but it is missing`);
}

const REQUIRED_SCRIPTS_BY_ARCHETYPE = {
	"app/astro": ["dev", "build", "test", "type-check"],
	"app/cli": ["build", "test", "type-check"],
	"app/service": ["build", "start", "test", "type-check"],
	"example/dgk-workbench": ["build", "dgk", "test", "type-check"],
	"validation/astro-wasi": ["build", "componentize", "test"],
	"validation/composite-workspace": ["test"],
	"validation/wasm-package": ["build", "lint", "test"],
};

function assertPackageCommandSmoke(itemDir, item) {
	const packagePath = join(itemDir, "package.json");
	if (!existsSync(packagePath)) return false;
	const pkg = readJson(packagePath);
	const requiredScripts = REQUIRED_SCRIPTS_BY_ARCHETYPE[item.archetype] ?? ["test"];
	for (const scriptName of requiredScripts) {
		assert.ok(pkg.scripts?.[scriptName], `${item.path} should declare script ${scriptName}`);
	}
	for (const entrypoint of Object.values(pkg.bin ?? {})) {
		assertBuiltEntrypointHasSource(itemDir, entrypoint, item.path);
	}
	if (pkg.main) assertBuiltEntrypointHasSource(itemDir, pkg.main, item.path);
	for (const script of Object.values(pkg.scripts ?? {})) {
		for (const target of extractNodeTargets(script)) {
			assertLocalNodeTarget(itemDir, item.path, target);
		}
	}
	return true;
}

function assertValidationScriptSmoke(itemDir, item) {
	if (item.archetype === "validation/poc-script") {
		assertAnyGeneratedFile(
			itemDir,
			(file) => file.endsWith(".mjs") && !file.endsWith(".test.mjs"),
			`${item.path} should generate a proof script`,
		);
		assertAnyGeneratedFile(
			itemDir,
			(file) => file.endsWith(".test.mjs"),
			`${item.path} should generate a proof test`,
		);
		return;
	}
	if (item.archetype === "validation/fixture-poc-script") {
		assertAnyGeneratedFile(
			itemDir,
			(file) => file.endsWith(".mjs") && !file.endsWith(".test.mjs"),
			`${item.path} should generate a fixture proof script`,
		);
		assertAnyGeneratedFile(
			itemDir,
			(file) => file.endsWith(".test.mjs"),
			`${item.path} should generate a fixture proof test`,
		);
		assertFileExists(itemDir, "fixtures/expected/scorecard.json");
		return;
	}
	if (item.archetype === "validation/substrate-probe") {
		assertFileExists(itemDir, "run-probe.mjs");
		assertFileExists(itemDir, "probe.test.mjs");
		assertFileExists(itemDir, "probe.rs");
	}
}

function assertGeneratedWorkspaceCommandSmoke(root, items) {
	for (const item of items) {
		const itemDir = join(root, item.path);
		assertNoTemplatePlaceholders(itemDir, item.path);
		const hasPackage = assertPackageCommandSmoke(itemDir, item);
		if (!hasPackage) assertValidationScriptSmoke(itemDir, item);
	}
}

test("turbo generators expose a DGK example workbench scaffold", async () => {
	const generators = await configuredGenerators();
	const generator = generators.get("example");
	assert.ok(generator, "expected turbo/generators/config.ts to register an example generator");
	assert.match(generator.description, /DGK example workbench/);

	const data = {
		name: "garden-lab",
		description: "Garden Lab — generated DGK workbench",
		personaVerb: "garden",
		personaTitle: "Garden",
		defaultPort: "4399",
	};
	const actions = generator.actions(data);
	assert.equal(data.pascalName, "GardenLab");
	assert.equal(data.constantName, "GARDEN_LAB");
	assert.equal(data.commandName, "dgk");
	assert.ok(actions.some((action) => action.type === "addMany" && action.destination === "examples/{{name}}"));

	const packageTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/example-dgk-workbench/package.json.hbs"),
		"utf8",
	);
	const packageJson = JSON.parse(render(packageTemplate, data));
	assert.equal(packageJson.name, "garden-lab");
	assert.equal(packageJson.bin.dgk, "./dist/cli.js");
	assert.equal(packageJson.scripts.dgk, "node dist/cli.js");
	assert.equal(packageJson.dependencies["@refarm.dev/capability-host"], "workspace:*");
	assert.equal(packageJson.dependencies["@refarm.dev/capabilities-v1"], "workspace:*");

	const cliTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/example-dgk-workbench/src/cli.ts.hbs"),
		"utf8",
	);
	const cli = render(cliTemplate, data);
	assert.match(cli, /defineCapabilityApp/);
	assert.match(cli, /defineCapabilityHost/);
	assert.doesNotMatch(cli, /runCapabilityHostCli/);
	assert.match(cli, /command: "dgk"/);
	assert.match(cli, /buildGardenLabHost/);
	assert.match(cli, /const gardenLabApp = defineCapabilityApp/);
	assert.match(cli, /export const buildRegistry = gardenLabApp\.registry/);
	assert.match(cli, /void gardenLabApp\.runCli\(import\.meta\.url/);
	assert.match(cli, /defaultPort: 4399/);

	const personaTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/example-dgk-workbench/src/persona.ts.hbs"),
		"utf8",
	);
	const persona = render(personaTemplate, data);
	assert.match(persona, /type CapabilityDeps/);
	assert.doesNotMatch(persona, /\bRefarmCapabilityDeps\b/);
	assert.match(persona, /function gardenLabCapabilityDeps\(\): CapabilityDeps/);

	const readmeTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/example-dgk-workbench/README.md.hbs"),
		"utf8",
	);
	assert.doesNotMatch(render(readmeTemplate, data), /\bRefarm\b/);

	const flowTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/example-dgk-workbench/src/flow.e2e.test.ts.hbs"),
		"utf8",
	);
	const flow = render(flowTemplate, data);
	assert.match(flow, /program\(\)\.name\(\)\)\.toBe\("dgk"\)/);
	assert.match(flow, /surfaceActions\(\)/);
});

test("turbo generators expose a validation POC script scaffold", async () => {
	const generators = await configuredGenerators();
	const generator = generators.get("validation");
	assert.ok(generator, "expected turbo/generators/config.ts to register a validation generator");
	assert.match(generator.description, /validation proof/);

	const data = {
		name: "availability-proof",
		description: "Availability proof validation",
	};
	const actions = generator.actions(data);
	assert.equal(data.pascalName, "AvailabilityProof");
	assert.equal(data.camelName, "availabilityProof");
	assert.ok(actions.some((action) => action.type === "addMany" && action.destination === "validations/{{name}}"));

	const proofTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/validation-poc-script/{{name}}.mjs.hbs"),
		"utf8",
	);
	const proof = render(proofTemplate, data);
	assert.match(proof, /buildAvailabilityProofEvidence/);
	assert.match(proof, /Availability proof validation/);

	const testTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/validation-poc-script/{{name}}.test.mjs.hbs"),
		"utf8",
	);
	const testFile = render(testTemplate, data);
	assert.match(testFile, /buildAvailabilityProofEvidence/);
	assert.match(testFile, /fixtures\/expected\/proof.json/);
});

test("turbo generators expose a fixture-backed validation scaffold", async () => {
	const generators = await configuredGenerators();
	const generator = generators.get("validation");
	assert.ok(generator);

	const data = {
		name: "wallet-proof",
		type: "fixture-poc-script",
		description: "Wallet proof validation",
	};
	const actions = generator.actions(data);
	assert.equal(data.pascalName, "WalletProof");
	assert.ok(actions.some((action) => action.type === "addMany" && action.destination === "validations/{{name}}"));

	const expectedTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/validation-fixture-poc-script/fixtures/expected/scorecard.json.hbs"),
		"utf8",
	);
	const expected = JSON.parse(render(expectedTemplate, data));
	assert.equal(expected.validation, "wallet-proof");
	assert.equal(expected.summary, "Wallet proof validation");

	const readmeTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/validation-fixture-poc-script/README.md.hbs"),
		"utf8",
	);
	assert.match(render(readmeTemplate, data), /fixtures\/expected/);
});

test("turbo generators expose app scaffolds for astro, cli, and service hosts", async () => {
	const generators = await configuredGenerators();
	const generator = generators.get("app");
	assert.ok(generator, "expected turbo/generators/config.ts to register an app generator");
	assert.match(generator.description, /Refarm app host/);

	const data = {
		name: "field-console",
		type: "cli",
		description: "Field console app",
		commandName: "field",
	};
	const actions = generator.actions(data);
	assert.equal(data.pascalName, "FieldConsole");
	assert.equal(data.camelName, "fieldConsole");
	assert.ok(actions.some((action) => action.type === "addMany" && action.destination === "apps/{{name}}"));

	const cliPackageTemplate = readFileSync(
		join(ROOT, "turbo/generators/templates/app-cli/package.json.hbs"),
		"utf8",
	);
	const cliPackage = JSON.parse(render(cliPackageTemplate, data));
	assert.equal(cliPackage.name, "@refarm.dev/field-console");
	assert.equal(cliPackage.bin.field, "./dist/index.js");
	assert.equal(cliPackage.scripts.build, "tsc --project tsconfig.build.json");

	for (const type of ["app-astro", "app-cli", "app-service"]) {
		const packageTemplate = join(ROOT, `turbo/generators/templates/${type}/package.json.hbs`);
		assert.doesNotThrow(() => readFileSync(packageTemplate, "utf8"), `${type} package template missing`);
	}
});

test("turbo generators expose specialized validation scaffolds", async () => {
	const generators = await configuredGenerators();
	const generator = generators.get("validation");
	assert.ok(generator);

	for (const type of ["astro-wasi", "substrate-probe", "wasm-package", "composite-workspace"]) {
		const data = {
			name: `${type}-proof`,
			type,
			description: `${type} validation`,
		};
		const actions = generator.actions(data);
		assert.ok(actions.some((action) => action.type === "addMany" && action.destination === "validations/{{name}}"));
		assert.doesNotThrow(
			() => readFileSync(join(ROOT, `turbo/generators/templates/validation-${type}/README.md.hbs`), "utf8"),
			`${type} README template missing`,
		);
	}

	const wasmPackage = JSON.parse(
		render(
			readFileSync(
				join(ROOT, "turbo/generators/templates/validation-wasm-package/package.json.hbs"),
				"utf8",
			),
			{ name: "plugin-proof", description: "Plugin proof", pascalName: "PluginProof", camelName: "pluginProof" },
		),
	);
	assert.equal(wasmPackage.name, "@refarm.dev/plugin-proof");
	assert.equal(wasmPackage.scripts.build, "node ../../scripts/ci/cargo-run.mjs component build --target wasm32-wasip1 --release");
});

test("turbo generators create inventory-covered app, example, and validation workspaces", async () => {
	const root = mkdtempSync(join(tmpdir(), "refarm-turbo-generator-conformance-"));
	try {
		const generators = await configuredGenerators();
		await materializeGeneratorWorkspace(root, generators.get("example"), {
			name: "garden-lab",
			type: "dgk-workbench",
			description: "Garden Lab generated example",
			personaVerb: "garden",
			personaTitle: "Garden",
			defaultPort: "4399",
		});
		await materializeGeneratorWorkspace(root, generators.get("app"), {
			name: "field-console",
			type: "cli",
			description: "Field console app",
			commandName: "field",
		});
		await materializeGeneratorWorkspace(root, generators.get("app"), {
			name: "field-site",
			type: "astro",
			description: "Field site app",
			commandName: "field-site",
		});
		await materializeGeneratorWorkspace(root, generators.get("app"), {
			name: "field-service",
			type: "service",
			description: "Field service app",
			commandName: "field-service",
		});
		await materializeGeneratorWorkspace(root, generators.get("validation"), {
			name: "availability-proof",
			type: "poc-script",
			description: "Availability proof validation",
		});
		await materializeGeneratorWorkspace(root, generators.get("validation"), {
			name: "wallet-proof",
			type: "fixture-poc-script",
			description: "Wallet proof validation",
		});
		await materializeGeneratorWorkspace(root, generators.get("validation"), {
			name: "astro-wasi-proof",
			type: "astro-wasi",
			description: "Astro WASI validation",
		});
		await materializeGeneratorWorkspace(root, generators.get("validation"), {
			name: "probe-proof",
			type: "substrate-probe",
			description: "Probe validation",
		});
		await materializeGeneratorWorkspace(root, generators.get("validation"), {
			name: "wasm-proof",
			type: "wasm-package",
			description: "WASM validation",
		});
		await materializeGeneratorWorkspace(root, generators.get("validation"), {
			name: "composite-proof",
			type: "composite-workspace",
			description: "Composite validation",
		});

		const report = buildScaffoldInventory({ root });
		const notCovered = report.items.filter((item) => item.status !== "covered");
		assert.deepEqual(notCovered, []);
		assertGeneratedWorkspaceCommandSmoke(root, report.items);
	} finally {
		rmSync(root, { force: true, recursive: true });
	}
});
