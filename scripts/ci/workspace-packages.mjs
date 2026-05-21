import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function readWorkspacePatterns(rootDir) {
	const workspaceFile = join(rootDir, "pnpm-workspace.yaml");
	if (!existsSync(workspaceFile)) return ["packages/*", "apps/*"];

	const patterns = [];
	let inPackages = false;
	for (const line of readFileSync(workspaceFile, "utf8").split(/\r?\n/)) {
		if (/^\S/.test(line)) {
			inPackages = line.trim() === "packages:";
			continue;
		}
		if (!inPackages) continue;

		const match = line.match(/^\s*-\s*["']?([^"']+)["']?\s*$/);
		if (match) patterns.push(match[1]);
	}

	return patterns.length > 0 ? patterns : ["packages/*", "apps/*"];
}

function expandPattern(rootDir, pattern) {
	const results = [];
	const segments = pattern.split(/[\\/]/).filter(Boolean);

	function walk(currentDir, index) {
		if (index >= segments.length) {
			const packageJson = join(currentDir, "package.json");
			if (existsSync(packageJson)) results.push(currentDir);
			return;
		}

		const segment = segments[index];
		if (segment !== "*") {
			const nextDir = join(currentDir, segment);
			if (existsSync(nextDir) && statSync(nextDir).isDirectory()) {
				walk(nextDir, index + 1);
			}
			return;
		}

		if (!existsSync(currentDir)) return;
		for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
			if (entry.isDirectory()) walk(join(currentDir, entry.name), index + 1);
		}
	}

	walk(rootDir, 0);
	return results;
}

export function readWorkspacePackages(rootDir) {
	const dirs = new Set(
		readWorkspacePatterns(rootDir).flatMap((pattern) => expandPattern(rootDir, pattern)),
	);
	return [...dirs]
		.map((dir) => {
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
			return { ...pkg, path: dir };
		})
		.filter((pkg) => typeof pkg.name === "string" && pkg.name.length > 0)
		.sort((a, b) => a.name.localeCompare(b.name));
}
