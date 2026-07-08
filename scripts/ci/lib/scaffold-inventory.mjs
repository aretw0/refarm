import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw new Error(`Failed to parse ${path}: ${err.message}`);
	}
}

function listWorkspaceDirs(root, workspaceRoot) {
	const absRoot = join(root, workspaceRoot);
	if (!existsSync(absRoot)) return [];
	return readdirSync(absRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(absRoot, entry.name))
		.sort();
}

function hasFile(dir, file) {
	return existsSync(join(dir, file));
}

function hasDirectory(dir, child) {
	const candidate = join(dir, child);
	return existsSync(candidate) && statSync(candidate).isDirectory();
}

function hasAnyFile(dir, predicate) {
	if (!existsSync(dir)) return false;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (["node_modules", "dist", ".turbo", ".astro"].includes(entry.name)) continue;
			if (hasAnyFile(fullPath, predicate)) return true;
			continue;
		}
		if (predicate(fullPath, entry.name)) return true;
	}
	return false;
}

function hasNestedWorkspaceManifest(dir) {
	if (!existsSync(dir)) return false;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (["node_modules", "dist", ".turbo", ".astro"].includes(entry.name)) continue;
		const child = join(dir, entry.name);
		if (hasFile(child, "package.json") || hasFile(child, "Cargo.toml")) return true;
		if (hasNestedWorkspaceManifest(child)) return true;
	}
	return false;
}

function dependenciesOf(pkg) {
	return {
		...(pkg?.dependencies ?? {}),
		...(pkg?.devDependencies ?? {}),
		...(pkg?.peerDependencies ?? {}),
	};
}

function hasDependency(pkg, name) {
	return Object.hasOwn(dependenciesOf(pkg), name);
}

function exportsToDist(exports) {
	if (typeof exports === "string") return exports.startsWith("./dist/");
	if (!exports || typeof exports !== "object") return false;
	return Object.values(exports).some((value) => {
		if (typeof value === "string") return value.startsWith("./dist/");
		if (!value || typeof value !== "object") return false;
		return Object.values(value).some((entry) => typeof entry === "string" && entry.startsWith("./dist/"));
	});
}

function classifyPackage(dir, pkg) {
	const scripts = pkg.scripts ?? {};
	const main = pkg.main ?? "";
	if (hasFile(dir, "Cargo.toml") && scripts["build:wasm"] && scripts["build:jco"]) return "package/wasm-jco-component";
	if (hasFile(dir, "Cargo.toml") && scripts["build:wasm"]) return "package/wasm-component";
	if (hasFile(dir, "Cargo.toml")) return "package/rust-only";
	if (main.startsWith("./src/") && /\.(mjs|js)$/.test(main)) return "package/js-tool";
	if (main.startsWith("./src/") && main.endsWith(".ts")) return "package/source-only";
	if (!main && !scripts.build) return "package/config";
	if (Object.keys(pkg.exports ?? {}).some((key) => key.startsWith("./styles/"))) return "package/ui-library";
	if ((main.startsWith("./dist/") || exportsToDist(pkg.exports)) && String(scripts.build ?? "").includes("tsc")) {
		return "package/buildable";
	}
	return "package/unknown";
}

function classifyApp(dir, pkg) {
	if (pkg.scripts?.start && hasDependency(pkg, "@refarm.dev/stream-contract-v1")) return "app/service";
	if (pkg.bin || hasFile(dir, "src/index.ts")) return "app/cli";
	if (hasFile(dir, "astro.config.mjs")) return "app/astro";
	return "app/custom";
}

function classifyExample(dir, pkg) {
	const scripts = pkg.scripts ?? {};
	const isDgkWorkbench =
		pkg.bin?.dgk === "./dist/cli.js" &&
		scripts.dgk === "node dist/cli.js" &&
		hasDependency(pkg, "@refarm.dev/capability-host") &&
		hasDependency(pkg, "@refarm.dev/capabilities-v1");
	if (isDgkWorkbench) return "example/dgk-workbench";
	return "example/legacy";
}

function classifyValidation(dir, pkg) {
	if (pkg && hasFile(dir, "astro.config.mjs")) return "validation/astro-wasi";
	if (pkg && hasFile(dir, "Cargo.toml")) return "validation/wasm-package";
	if (pkg && hasNestedWorkspaceManifest(dir)) return "validation/composite-workspace";
	if (pkg) return "validation/workspace";
	if (hasNestedWorkspaceManifest(dir)) return "validation/composite-workspace";
	if (hasFile(dir, "probe.rs")) return "validation/substrate-probe";
	const hasMjs = hasAnyFile(dir, (_path, name) => name.endsWith(".mjs"));
	const hasMjsTest = hasAnyFile(dir, (_path, name) => name.endsWith(".test.mjs"));
	if (
		hasDirectory(dir, "fixtures") &&
		(hasFile(dir, "fixtures/expected/scorecard.json") ||
			hasFile(dir, "fixtures/expected/task-artifacts.json"))
	) return "validation/fixture-poc-script";
	if (hasMjs && hasMjsTest) return "validation/poc-script";
	if (hasDirectory(dir, "fixtures")) return "validation/fixture-poc-script";
	return "validation/fixture-proof";
}

const SOWER_SKIPPED_TEMPLATE_ENTRIES = new Set([
	".astro",
	".turbo",
	"dist",
	"node_modules",
]);

const COPIED_TEMPLATE_ARTIFACT_DIRS = new Set([
	".next",
	".svelte-kit",
	"coverage",
	"pkg",
	"target",
]);

function listTemplateFindings(root, dir) {
	const findings = [];
	function walk(current) {
		for (const entry of readdirSync(current, { withFileTypes: true })) {
			const fullPath = join(current, entry.name);
			if (entry.isDirectory()) {
				if (SOWER_SKIPPED_TEMPLATE_ENTRIES.has(entry.name)) continue;
				walk(fullPath);
				continue;
			}
			const rel = relative(root, fullPath);
			const segments = rel.split(/[\\/]/);
			if (segments.some((segment) => COPIED_TEMPLATE_ARTIFACT_DIRS.has(segment))) {
				findings.push({
					id: "copied-artifact-in-template",
					severity: "warning",
					path: rel,
					summary: "Template contains build/cache output that scaffold copy would include.",
				});
			}
		}
	}
	if (existsSync(dir)) walk(dir);
	return findings;
}

function makeItem(root, dir, rootName, archetype, status, expectedGenerator, findings = []) {
	return {
		path: relative(root, dir),
		root: rootName,
		archetype,
		status,
		expectedGenerator,
		findings,
	};
}

function summarize(items) {
	const summary = {
		total: items.length,
		byRoot: {},
		byStatus: {},
		byArchetype: {},
	};
	for (const item of items) {
		summary.byRoot[item.root] = (summary.byRoot[item.root] ?? 0) + 1;
		summary.byStatus[item.status] = (summary.byStatus[item.status] ?? 0) + 1;
		summary.byArchetype[item.archetype] = (summary.byArchetype[item.archetype] ?? 0) + 1;
	}
	return summary;
}

export function buildScaffoldInventory(options = {}) {
	const root = resolve(options.root ?? process.cwd());
	const items = [];

	for (const dir of listWorkspaceDirs(root, "packages")) {
		const pkg = readJson(join(dir, "package.json"));
		if (!pkg) continue;
		items.push(makeItem(root, dir, "packages", classifyPackage(dir, pkg), "covered", "turbo gen package"));
	}

	for (const dir of listWorkspaceDirs(root, "apps")) {
		const pkg = readJson(join(dir, "package.json"));
		if (!pkg) continue;
		const archetype = classifyApp(dir, pkg);
		items.push(
			makeItem(
				root,
				dir,
				"apps",
				archetype,
				["app/astro", "app/cli", "app/service"].includes(archetype)
					? "covered"
					: "needs-generator",
				"turbo gen app",
			),
		);
	}

	for (const dir of listWorkspaceDirs(root, "examples")) {
		const pkg = readJson(join(dir, "package.json"));
		if (!pkg) continue;
		const archetype = classifyExample(dir, pkg);
		items.push(
			makeItem(
				root,
				dir,
				"examples",
				archetype,
				archetype === "example/dgk-workbench" ? "covered" : "review",
				"turbo gen example",
			),
		);
	}

	for (const dir of listWorkspaceDirs(root, "validations")) {
		const pkg = readJson(join(dir, "package.json"));
		const archetype = classifyValidation(dir, pkg);
		items.push(
			makeItem(
				root,
				dir,
				"validations",
				archetype,
				[
					"validation/poc-script",
					"validation/fixture-poc-script",
					"validation/astro-wasi",
					"validation/substrate-probe",
					"validation/wasm-package",
					"validation/composite-workspace",
				].includes(archetype)
					? "covered"
					: "needs-generator",
				"turbo gen validation",
			),
		);
	}

	for (const dir of listWorkspaceDirs(root, "templates")) {
		if (!statSync(dir).isDirectory()) continue;
		const manifest = readJson(join(dir, "refarm.template.json"));
		const hasManifest =
			manifest?.schemaVersion === 1 &&
			typeof manifest.id === "string" &&
			typeof manifest.source === "string";
		const findings = listTemplateFindings(root, dir);
		items.push(
			makeItem(
				root,
				dir,
				"templates",
				hasManifest ? "template/sower-manifest" : "template/sower",
				hasManifest && findings.length === 0 ? "covered" : "parallel-factory",
				"refarm scaffold template",
				findings,
			),
		);
	}

	return {
		schemaVersion: 1,
		command: "scaffold-inventory",
		operation: "inventory",
		ok: true,
		generatedAt: options.now?.toISOString?.() ?? new Date().toISOString(),
		root,
		summary: summarize(items),
		items,
	};
}
