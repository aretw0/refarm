#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const DEPENDENCY_SECTIONS = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
];

function parseArgs(argv) {
	const args = new Map();
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[i + 1];
		if (!next || next.startsWith("--")) {
			args.set(key, true);
		} else {
			const current = args.get(key);
			if (current === undefined) {
				args.set(key, next);
			} else if (Array.isArray(current)) {
				current.push(next);
			} else {
				args.set(key, [current, next]);
			}
			i += 1;
		}
	}
	return args;
}

function values(value) {
	if (value === undefined) return [];
	return Array.isArray(value) ? value : [value];
}

function parseExternalSpecs(specs) {
	const external = new Map();
	for (const spec of specs) {
		const split = spec.lastIndexOf("=");
		if (split <= 0 || split === spec.length - 1) {
			throw new Error(`Invalid --external value: ${spec}`);
		}
		external.set(spec.slice(0, split), spec.slice(split + 1));
	}
	return external;
}

function isWorkspaceRange(range) {
	return typeof range === "string" && range.startsWith("workspace:");
}

function sortObjectKeys(value) {
	return Object.fromEntries(
		Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
	);
}

function stringifyPackageJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

export function transformPackageWorkspaceAdoptionWithReport(
	json,
	{ name, external = new Map() } = {},
) {
	const manifest = JSON.parse(json);
	const next = structuredClone(manifest);
	let nameChanged = false;
	let workspaceDependenciesRewritten = 0;

	if (typeof name === "string" && name.length > 0 && next.name !== name) {
		next.name = name;
		nameChanged = true;
	}

	for (const sectionName of DEPENDENCY_SECTIONS) {
		const section = next[sectionName];
		if (!section || typeof section !== "object" || Array.isArray(section)) {
			continue;
		}
		let touched = false;
		for (const [packageName, range] of Object.entries(section)) {
			if (!isWorkspaceRange(range) || !external.has(packageName)) continue;
			section[packageName] = external.get(packageName);
			workspaceDependenciesRewritten += 1;
			touched = true;
		}
		if (touched) {
			next[sectionName] = sortObjectKeys(section);
		}
	}

	const output = stringifyPackageJson(next);
	return {
		json: output,
		changed: output !== json,
		nameChanged,
		workspaceDependenciesRewritten,
	};
}

export function transformPackageWorkspaceAdoption(json, options) {
	return transformPackageWorkspaceAdoptionWithReport(json, options).json;
}

const args = parseArgs(process.argv.slice(2));
if (args.size > 0) {
	const input = args.get("input");
	if (typeof input !== "string") {
		console.error(
			"Usage: node codemods/package-workspace-adoption.mjs --input <package.json> [--name <package-name>] [--external <package=range>] [--write] [--json]",
		);
		process.exit(2);
	}

	let external;
	try {
		external = parseExternalSpecs(values(args.get("external")));
	} catch (error) {
		console.error(error.message);
		process.exit(2);
	}

	const original = readFileSync(input, "utf8");
	const result = transformPackageWorkspaceAdoptionWithReport(original, {
		name: args.get("name"),
		external,
	});
	if (args.get("write")) {
		writeFileSync(input, result.json);
	}
	if (args.get("json")) {
		process.stdout.write(
			`${JSON.stringify(
				{
					input,
					changed: result.changed,
					nameChanged: result.nameChanged,
					workspaceDependenciesRewritten:
						result.workspaceDependenciesRewritten,
					written: Boolean(args.get("write")),
				},
				null,
				2,
			)}\n`,
		);
	} else {
		process.stdout.write(result.json);
	}
}
