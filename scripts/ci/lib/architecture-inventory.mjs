import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const WORKSPACE_ROOTS = ["apps", "packages"];
const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];
const SKIPPED_DIRECTORIES = new Set([
	".astro",
	".turbo",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"pkg",
	"target",
]);

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

function listWorkspaceDirectories(root) {
	return WORKSPACE_ROOTS.flatMap((workspaceRoot) => {
		const absoluteRoot = join(root, workspaceRoot);
		if (!existsSync(absoluteRoot)) return [];
		return readdirSync(absoluteRoot, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && (
				existsSync(join(absoluteRoot, entry.name, "package.json")) ||
				existsSync(join(absoluteRoot, entry.name, "Cargo.toml"))
			))
			.map((entry) => join(absoluteRoot, entry.name));
	}).sort();
}

function visitSourceFiles(directory, visitor) {
	if (!existsSync(directory) || !statSync(directory).isDirectory()) return;
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) visitSourceFiles(path, visitor);
		else visitor(path, entry.name);
	}
}

function detectLanguages(directory) {
	const languages = new Set();
	if (existsSync(join(directory, "Cargo.toml"))) languages.add("Rust");
	if (existsSync(join(directory, "astro.config.mjs"))) languages.add("Astro");

	for (const sourceRoot of [join(directory, "src"), join(directory, "wit")]) {
		visitSourceFiles(sourceRoot, (_path, name) => {
			if (/\.(?:ts|tsx|mts|cts)$/.test(name)) languages.add("TypeScript");
			else if (/\.(?:js|jsx|mjs|cjs)$/.test(name)) languages.add("JavaScript");
			else if (name.endsWith(".rs")) languages.add("Rust");
			else if (name.endsWith(".wit")) languages.add("WIT");
		});
	}

	return [...languages].sort();
}

function declaredDependencyScopes(pkg) {
	const scopes = new Map();
	for (const field of DEPENDENCY_FIELDS) {
		for (const name of Object.keys(pkg?.[field] ?? {})) {
			const current = scopes.get(name) ?? [];
			current.push(field);
			scopes.set(name, current);
		}
	}
	return scopes;
}

function cargoMetadata(directory) {
	const manifestPath = join(directory, "Cargo.toml");
	if (!existsSync(manifestPath)) return { name: null, paths: [] };
	const manifest = readFileSync(manifestPath, "utf8");
	const packageStart = manifest.indexOf("[package]");
	const afterPackage = packageStart === -1 ? "" : manifest.slice(packageStart + "[package]".length);
	const nextSection = afterPackage.search(/\n\[/);
	const packageSection = nextSection === -1 ? afterPackage : afterPackage.slice(0, nextSection);
	const name = packageSection.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? null;
	const paths = [...manifest.matchAll(/\bpath\s*=\s*"([^"]+)"/g)]
		.map((match) => resolve(directory, match[1]));
	return { name, paths };
}

function owningWorkspace(target, workspaces) {
	return workspaces
		.filter((workspace) => {
			const fromWorkspace = relative(workspace.directory, target);
			return fromWorkspace === "" || (!fromWorkspace.startsWith("..") && !isAbsolute(fromWorkspace));
		})
		.sort((left, right) => right.directory.length - left.directory.length)[0] ?? null;
}

function findCycles(workspaces) {
	const graph = new Map(workspaces.map((workspace) => [workspace.name, workspace.internalDependencies]));
	let index = 0;
	const indices = new Map();
	const lowLinks = new Map();
	const stack = [];
	const onStack = new Set();
	const cycles = [];

	function connect(name) {
		indices.set(name, index);
		lowLinks.set(name, index);
		index += 1;
		stack.push(name);
		onStack.add(name);

		for (const dependency of graph.get(name) ?? []) {
			if (!indices.has(dependency)) {
				connect(dependency);
				lowLinks.set(name, Math.min(lowLinks.get(name), lowLinks.get(dependency)));
			} else if (onStack.has(dependency)) {
				lowLinks.set(name, Math.min(lowLinks.get(name), indices.get(dependency)));
			}
		}

		if (lowLinks.get(name) !== indices.get(name)) return;
		const component = [];
		let member;
		do {
			member = stack.pop();
			onStack.delete(member);
			component.push(member);
		} while (member !== name);
		const selfCycle = component.length === 1 && (graph.get(name) ?? []).includes(name);
		if (component.length > 1 || selfCycle) cycles.push(component.sort());
	}

	for (const name of [...graph.keys()].sort()) {
		if (!indices.has(name)) connect(name);
	}
	return cycles.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function countBy(items, selector) {
	const counts = {};
	for (const item of items) {
		const key = selector(item);
		counts[key] = (counts[key] ?? 0) + 1;
	}
	return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function buildArchitectureInventory(options = {}) {
	const root = resolve(options.root ?? process.cwd());
	const raw = listWorkspaceDirectories(root).map((directory) => {
		const packagePath = join(directory, "package.json");
		const pkg = existsSync(packagePath) ? readJson(packagePath) : null;
		const cargo = cargoMetadata(directory);
		return {
			name: pkg?.name ?? cargo.name,
			path: relative(root, directory),
			kind: relative(root, directory).startsWith("apps/") ? "app" : "package",
			languages: detectLanguages(directory),
			declaredDependencyScopes: declaredDependencyScopes(pkg),
			cargoPaths: cargo.paths,
			directory,
		};
	});
	const names = new Set(raw.map((workspace) => workspace.name));
	const workspaces = raw.map((workspace) => {
		const cargoDependencies = workspace.cargoPaths
			.map((target) => owningWorkspace(target, raw))
			.filter((owner) => owner && owner !== workspace)
			.map((owner) => owner.name);
		const internalDependencyScopes = new Map(
			[...workspace.declaredDependencyScopes.entries()]
				.filter(([name]) => names.has(name))
				.map(([name, scopes]) => [name, [...scopes].sort()]),
		);
		for (const dependency of cargoDependencies) {
			internalDependencyScopes.set(dependency, [
				...new Set([...(internalDependencyScopes.get(dependency) ?? []), "cargo-path"]),
			].sort());
		}
		const sortedScopes = [...internalDependencyScopes.entries()].sort(([left], [right]) => left.localeCompare(right));
		return {
			name: workspace.name,
			path: workspace.path,
			kind: workspace.kind,
			languages: workspace.languages,
			internalDependencies: sortedScopes.map(([name]) => name),
			internalDependencyScopes: Object.fromEntries(sortedScopes),
		};
	}).sort((left, right) => left.path.localeCompare(right.path));
	const apps = new Set(workspaces.filter((workspace) => workspace.kind === "app").map((workspace) => workspace.name));
	const packageToApp = workspaces
		.filter((workspace) => workspace.kind === "package")
		.flatMap((workspace) => workspace.internalDependencies
			.filter((dependency) => apps.has(dependency))
			.map((dependency) => ({ from: workspace.name, to: dependency })))
		.sort((left, right) => `${left.from}\0${left.to}`.localeCompare(`${right.from}\0${right.to}`));
	const cycles = findCycles(workspaces);
	const duplicateNames = [...new Set(raw
		.map((workspace) => workspace.name)
		.filter((name, position, all) => all.indexOf(name) !== position))].sort();
	const unnamed = workspaces.filter((workspace) => typeof workspace.name !== "string" || workspace.name.length === 0)
		.map((workspace) => workspace.path);
	const violations = [
		...duplicateNames.map((name) => ({ id: "duplicate-workspace-name", name })),
		...unnamed.map((path) => ({ id: "unnamed-workspace", path })),
		...packageToApp.map((edge) => ({ id: "package-depends-on-app", ...edge })),
		...cycles.map((members) => ({ id: "internal-dependency-cycle", members })),
	];

	return {
		schemaVersion: 1,
		command: "architecture-inventory",
		ok: violations.length === 0,
		summary: {
			workspaces: workspaces.length,
			apps: workspaces.filter((workspace) => workspace.kind === "app").length,
			packages: workspaces.filter((workspace) => workspace.kind === "package").length,
			contracts: workspaces.filter((workspace) => workspace.kind === "package" && workspace.name?.endsWith("-contract-v1")).length,
			byLanguageProfile: countBy(workspaces, (workspace) => workspace.languages.join(" + ") || "metadata-only"),
		},
		invariants: {
			duplicateNames,
			packageToApp,
			cycles,
			violations,
		},
		workspaces,
	};
}

function escapeCell(value) {
	return String(value).replaceAll("|", "\\|");
}

export function renderArchitectureInventoryMarkdown(report) {
	const lines = [
		"# Architecture Inventory",
		"",
		"> Deterministic snapshot generated from workspace manifests and source trees.",
		"> Run `pnpm run architecture:inventory:write` to update and `pnpm run architecture:check` to verify.",
		"",
		"This file records observable repository structure. Domain boundaries and language authority remain architectural decisions documented in [ARCHITECTURE.md](./ARCHITECTURE.md).",
		"",
		"## Summary",
		"",
		"| Measure | Count |",
		"|---|---:|",
		`| Architectural units in \`apps/*\` and \`packages/*\` | ${report.summary.workspaces} |`,
		`| Distros / hosts (\`apps/*\`) | ${report.summary.apps} |`,
		`| Reusable blocks (\`packages/*\`) | ${report.summary.packages} |`,
		`| Contract packages (name ends in \`-contract-v1\`) | ${report.summary.contracts} |`,
		"",
		"### Implementation profiles",
		"",
		"| Source profile | Workspaces |",
		"|---|---:|",
		...Object.entries(report.summary.byLanguageProfile).map(([profile, count]) => `| ${escapeCell(profile)} | ${count} |`),
		"",
		"## Structural fitness",
		"",
		`- Unique workspace names: ${report.invariants.duplicateNames.length === 0 ? "pass" : "fail"}`,
		`- No package depends on an app: ${report.invariants.packageToApp.length === 0 ? "pass" : "fail"}`,
		`- Internal dependency graph is acyclic: ${report.invariants.cycles.length === 0 ? "pass" : "fail"}`,
		"",
		"## Workspaces",
		"",
		"| Workspace | Kind | Source | Internal deps |",
		"|---|---|---|---:|",
		...report.workspaces.map((workspace) =>
			`| \`${escapeCell(workspace.path)}\`<br>\`${escapeCell(workspace.name)}\` | ${workspace.kind} | ${escapeCell(workspace.languages.join(" + ") || "metadata-only")} | ${workspace.internalDependencies.length} |`),
		"",
	];
	return lines.join("\n");
}
