import path from "node:path";

/**
 * Stable directory roles owned by a sovereign application.
 *
 * The substrate deliberately does not choose a product name, home directory,
 * environment variable, or XDG policy. The host supplies one absolute root;
 * plugins and apps consume named roles instead of inventing filesystem paths.
 */
export interface SovereignDirectories {
	root: string;
	config: string;
	data: string;
	state: string;
	cache: string;
	runtime: string;
	distribution: string;
	plugins: string;
}

export function sovereignDirectories(root: string): SovereignDirectories {
	if (!path.isAbsolute(root)) {
		throw new TypeError(`Sovereign root must be absolute: ${JSON.stringify(root)}`);
	}

	const normalizedRoot = path.normalize(root);
	return Object.freeze({
		root: normalizedRoot,
		config: normalizedRoot,
		data: path.join(normalizedRoot, "data"),
		state: path.join(normalizedRoot, "state"),
		cache: path.join(normalizedRoot, "cache"),
		runtime: path.join(normalizedRoot, "runtime"),
		distribution: path.join(normalizedRoot, "dist"),
		plugins: path.join(normalizedRoot, "plugins"),
	});
}
