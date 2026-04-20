#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const tscBin = path.join(repoRoot, "node_modules", ".bin", "tsc");

function readJson(file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

function exists(p) {
	try {
		fs.accessSync(p, fs.constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function shouldGuardProject(dir) {
	const pkgPath = path.join(dir, "package.json");
	if (!exists(pkgPath)) return false;

	const scripts = readJson(pkgPath).scripts || {};
	if (typeof scripts["type-check"] === "string") return true;

	const lint = String(scripts.lint || "");
	return lint.includes("tsc") && lint.includes("--noEmit");
}

function listProjectTsconfigs() {
	const roots = ["packages", "apps"];
	const files = [];

	for (const root of roots) {
		const rootAbs = path.join(repoRoot, root);
		if (!exists(rootAbs)) continue;

		for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = path.join(rootAbs, entry.name);
			if (!shouldGuardProject(dir)) continue;
			const tsconfig = path.join(dir, "tsconfig.json");
			if (exists(tsconfig)) files.push(tsconfig);
		}
	}

	return files.sort();
}

function stripAnsi(text) {
	return String(text || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function runShowConfig(tsconfigPath) {
	const rel = path.relative(repoRoot, tsconfigPath);
	const command = exists(tscBin)
		? {
				cmd: tscBin,
				args: ["--project", rel, "--showConfig", "--pretty", "false"],
			}
		: {
				cmd: "npx",
				args: [
					"-p",
					"typescript@6.0.3",
					"tsc",
					"--project",
					rel,
					"--showConfig",
					"--pretty",
					"false",
				],
			};

	const run = spawnSync(command.cmd, command.args, {
		cwd: repoRoot,
		encoding: "utf8",
		timeout: 120000,
	});

	return {
		ok: run.status === 0,
		stdout: stripAnsi(run.stdout),
		stderr: stripAnsi(run.stderr),
		timedOut: Boolean(run.error && run.error.code === "ETIMEDOUT"),
	};
}

function parseShowConfig(output) {
	const start = output.indexOf("{");
	if (start < 0) return null;
	return JSON.parse(output.slice(start));
}

function walkSourceFiles(dir, acc = []) {
	if (!exists(dir)) return acc;

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (
				entry.name === "node_modules" ||
				entry.name === "dist" ||
				entry.name === "build"
			)
				continue;
			walkSourceFiles(full, acc);
			continue;
		}
		if (/\.(ts|tsx|mts|cts|astro)$/.test(entry.name)) acc.push(full);
	}

	return acc;
}

function collectImports(file) {
	const src = fs.readFileSync(file, "utf8");
	const imports = new Set();
	const re =
		/from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

	let m;
	while ((m = re.exec(src))) {
		const spec = m[1] || m[2] || m[3];
		if (spec) imports.add(spec);
	}

	const usesNodeBuiltin = /["']node:[^"']+["']/.test(src);
	return { imports: [...imports], usesNodeBuiltin };
}

function matchAlias(specifier, aliasKey) {
	if (!aliasKey.includes("*")) return specifier === aliasKey ? "" : null;
	const [prefix, suffix] = aliasKey.split("*");
	if (!specifier.startsWith(prefix)) return null;
	if (!specifier.endsWith(suffix)) return null;
	return specifier.slice(prefix.length, specifier.length - suffix.length);
}

function resolveAliasTarget(specifier, paths, projectDir, baseUrl) {
	for (const [alias, targets] of Object.entries(paths || {})) {
		const starValue = matchAlias(specifier, alias);
		if (starValue === null) continue;
		if (!Array.isArray(targets) || targets.length === 0) return null;

		const rawTarget = String(targets[0]).replaceAll("*", starValue);
		const resolved = path.resolve(projectDir, baseUrl || ".", rawTarget);
		return { rawTarget, resolved };
	}

	return null;
}

function isInside(child, parent) {
	const rel = path.relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function targetLooksLikeSource(rawTarget, resolved) {
	const raw = rawTarget.replaceAll("\\", "/").toLowerCase();
	if (raw.endsWith(".d.ts")) return false;
	if (raw.includes("/dist/") || raw.startsWith("dist/")) return false;
	if (raw.includes("/src/") || raw.startsWith("src/")) return true;
	if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(raw)) return true;

	if (exists(resolved)) {
		const stat = fs.statSync(resolved);
		if (stat.isFile()) {
			const ext = path.extname(resolved).toLowerCase();
			return (
				ext !== ".d.ts" &&
				[".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(
					ext,
				)
			);
		}
		if (stat.isDirectory()) {
			const sourceIndex = [
				"index.ts",
				"index.tsx",
				"index.mts",
				"index.cts",
				"index.js",
			].some((f) => exists(path.join(resolved, f)));
			return sourceIndex;
		}
	}

	return false;
}

function main() {
	const problems = [];
	const projects = listProjectTsconfigs();

	for (const tsconfigPath of projects) {
		const projectDir = path.dirname(tsconfigPath);
		const projectRel = path.relative(repoRoot, projectDir);

		const show = runShowConfig(tsconfigPath);
		if (!show.ok) {
			const detail = show.timedOut
				? "tsc --showConfig timed out"
				: (show.stderr || show.stdout || "tsc --showConfig failed")
						.trim()
						.split("\n")[0];
			problems.push({ project: projectRel, kind: "showConfig", detail });
			continue;
		}

		let config;
		try {
			config = parseShowConfig(show.stdout);
		} catch (err) {
			problems.push({
				project: projectRel,
				kind: "showConfig",
				detail: `could not parse --showConfig output (${String(err.message || err)})`,
			});
			continue;
		}

		const options = config?.compilerOptions || {};
		const baseUrl = options.baseUrl || ".";
		const paths = options.paths || {};
		const rootDir = options.rootDir || ".";
		const rootDirAbs = path.resolve(projectDir, rootDir);
		const ignoreDeprecations = options.ignoreDeprecations;
		const hasBaseUrl = options.baseUrl !== undefined;
		const types = Array.isArray(options.types) ? options.types : [];

		if (
			hasBaseUrl &&
			ignoreDeprecations !== "6.0" &&
			ignoreDeprecations !== "5.0"
		) {
			problems.push({
				project: projectRel,
				kind: "ignoreDeprecations",
				detail: `baseUrl is set but ignoreDeprecations is '${String(ignoreDeprecations)}'`,
			});
		}

		const sourceFiles = walkSourceFiles(path.join(projectDir, "src"));
		let sawNodeBuiltin = false;

		for (const file of sourceFiles) {
			const { imports, usesNodeBuiltin } = collectImports(file);
			if (usesNodeBuiltin) sawNodeBuiltin = true;

			for (const spec of imports) {
				const resolved = resolveAliasTarget(spec, paths, projectDir, baseUrl);
				if (!resolved) continue;
				if (!targetLooksLikeSource(resolved.rawTarget, resolved.resolved))
					continue;

				if (!isInside(resolved.resolved, rootDirAbs)) {
					problems.push({
						project: projectRel,
						kind: "rootDir",
						detail: `import '${spec}' resolves outside rootDir '${rootDir}'`,
						file: path.relative(repoRoot, file),
					});
				}
			}
		}

		if (sawNodeBuiltin && !types.includes("node")) {
			problems.push({
				project: projectRel,
				kind: "types",
				detail:
					"node:* imports found but compilerOptions.types does not include 'node'",
			});
		}
	}

	if (problems.length === 0) {
		console.log(`TSConfig guard: OK (${projects.length} projects scanned)`);
		return;
	}

	console.error(`TSConfig guard: FAIL (${problems.length} issue(s))`);
	for (const p of problems) {
		const filePart = p.file ? ` | file=${p.file}` : "";
		console.error(`- [${p.kind}] ${p.project}: ${p.detail}${filePart}`);
	}
	process.exit(1);
}

main();
