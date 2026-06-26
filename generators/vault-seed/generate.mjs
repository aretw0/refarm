import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from "node:fs";
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

function writeFileFromSource({ sourceDir, outDir, source, target }) {
	const sourcePath = path.join(sourceDir, ...source.split("/"));
	const targetPath = path.join(outDir, ...target.split("/"));
	mkdirSync(path.dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, readFileSync(sourcePath));
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

export async function generateVault({ manifest, sourceDir, outDir }) {
	assertValidInputs({ manifest, sourceDir, outDir });

	mkdirSync(outDir, { recursive: true });

	const renames = indexBySource(manifest.renames ?? []);
	const transforms = indexBySource(manifest.transforms ?? []);
	const skipEntries = [
		...(manifest.devOnly ?? []),
		...(manifest.derivedOrLocalState ?? []),
	];
	const { files, skipped } = walkFiles(sourceDir, { skipEntries });
	const written = [];
	const inventory = [];

	for (const source of files) {
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
