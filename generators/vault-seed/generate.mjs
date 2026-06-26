import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

function toRelativePath(root, filePath) {
	return path.relative(root, filePath).split(path.sep).join("/");
}

function isListedPath(relativePath, entries) {
	return entries.some(
		(entry) => relativePath === entry || relativePath.startsWith(`${entry}/`),
	);
}

function indexBySource(entries) {
	return new Map(entries.map((entry) => [entry.source, entry]));
}

function assertValidInputs({ manifest, sourceDir, outDir }) {
	if (!manifest || typeof manifest !== "object") {
		throw new Error("manifest is required");
	}
	if (!sourceDir || !existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
		throw new Error(`sourceDir does not exist: ${sourceDir}`);
	}
	if (!outDir) {
		throw new Error("outDir is required");
	}
}

function walkFiles(root, options = {}) {
	const files = [];
	const skipped = [];
	const skipEntries = options.skipEntries ?? [];

	function visit(dir) {
		for (const name of readdirSync(dir).sort()) {
			const current = path.join(dir, name);
			const relativePath = toRelativePath(root, current);
			const stat = statSync(current);
			if (stat.isDirectory()) {
				if (isListedPath(relativePath, skipEntries)) {
					skipped.push(relativePath);
					continue;
				}
				visit(current);
				continue;
			}
			if (!stat.isFile()) continue;
			files.push(relativePath);
		}
	}

	visit(root);
	return { files, skipped };
}

function gitTrackedFiles(root) {
	if (!existsSync(path.join(root, ".git"))) return null;
	try {
		return execFileSync("git", ["ls-files", "-z"], {
			cwd: root,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.split("\0")
			.filter(Boolean)
			.sort(comparePath);
	} catch {
		return null;
	}
}

function listSourceFiles(root, skipEntries) {
	const tracked = gitTrackedFiles(root);
	if (!tracked) return walkFiles(root, { skipEntries });

	return {
		files: tracked,
		skipped: skipEntries.filter((entry) =>
			existsSync(path.join(root, ...entry.split("/"))),
		),
	};
}

function ownerFromOptions(owner) {
	if (owner) return owner;
	return (process.env.GITHUB_REPOSITORY ?? "/").split("/")[0] || undefined;
}

function formatJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function applyTransform(content, transform, options) {
	switch (transform) {
		case "rename":
			return content;
		case "status-draft-to-published":
			return content.replace(/^status: draft$/m, "status: published");
		case "drop-kudos": {
			const config = JSON.parse(content);
			delete config.kudos;
			return formatJson(config);
		}
		case "set-license-holder": {
			const owner = ownerFromOptions(options.owner);
			if (!owner) return content;
			const config = JSON.parse(content);
			config.license = {
				...(config.license ?? {}),
				holder: owner,
				holderUrl: `https://github.com/${owner}`,
			};
			return formatJson(config);
		}
		default:
			throw new Error(`Unsupported vault-seed transform: ${transform}`);
	}
}

function transformContent(content, transforms, options) {
	return transforms.reduce(
		(nextContent, transform) =>
			applyTransform(nextContent, transform, options),
		content,
	);
}

function writeFileFromSource({
	sourceDir,
	outDir,
	source,
	target,
	transforms,
	owner,
}) {
	const sourcePath = path.join(sourceDir, ...source.split("/"));
	const targetPath = path.join(outDir, ...target.split("/"));
	mkdirSync(path.dirname(targetPath), { recursive: true });
	const buffer = readFileSync(sourcePath);
	const contentTransforms = (transforms ?? []).filter(
		(transform) => transform !== "rename",
	);
	if (contentTransforms.length === 0) {
		writeFileSync(targetPath, buffer);
		return;
	}
	writeFileSync(
		targetPath,
		transformContent(buffer.toString("utf8"), contentTransforms, { owner }),
	);
}

function inventoryFor(entry, fallback) {
	const inventory = {
		source: entry.source,
		target: entry.target,
		class: entry.class ?? fallback.class,
		transforms: entry.transforms ?? fallback.transforms,
	};
	if (entry.validation) inventory.validation = entry.validation;
	return inventory;
}

function comparePath(left, right) {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

export async function generateVault({ manifest, sourceDir, outDir, owner }) {
	assertValidInputs({ manifest, sourceDir, outDir });

	mkdirSync(outDir, { recursive: true });

	const renames = indexBySource(manifest.renames ?? []);
	const renameTargets = new Set(
		(manifest.renames ?? []).map((entry) => entry.target),
	);
	const transforms = indexBySource(manifest.transforms ?? []);
	const skipEntries = [
		...(manifest.devOnly ?? []),
		...(manifest.derivedOrLocalState ?? []),
	];
	const { files, skipped } = listSourceFiles(sourceDir, skipEntries);
	const written = [];
	const inventory = [];

	for (const source of files) {
		if (renameTargets.has(source) && !renames.has(source)) {
			skipped.push(source);
			continue;
		}

		const rename = renames.get(source);
		const transform = transforms.get(source);
		const entry =
			rename ??
			transform ??
			(isListedPath(source, skipEntries)
				? null
				: {
						source,
						target: source,
						class: "payload",
						transforms: [],
					});

		if (!entry) {
			skipped.push(source);
			continue;
		}

		writeFileFromSource({
			sourceDir,
			outDir,
			source,
			target: entry.target,
			transforms: entry.transforms ?? [],
			owner,
		});
		written.push(entry.target);
		inventory.push(
			inventoryFor(entry, {
				class: "payload",
				transforms: [],
			}),
		);
	}

	written.sort(comparePath);
	inventory.sort((left, right) => comparePath(left.target, right.target));
	skipped.sort(comparePath);

	return { written, skipped, inventory };
}
