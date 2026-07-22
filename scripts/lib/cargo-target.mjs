/**
 * One resolver for "where does cargo put artifacts in this checkout" — the
 * same precedence cargo itself applies: `CARGO_TARGET_DIR` env, then the
 * workspace `.cargo/config.toml` `target-dir` (relative values resolve against
 * the directory holding the config, i.e. the repo root), then the repo default.
 * Scripts must consult this instead of hardcoding a target path: the target
 * dir has moved before (packages/tractor/target → .cache/cargo-target) and
 * every hardcoded copy went stale silently.
 */
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export function resolveCargoTargetDir(root, env = process.env) {
	if (env.CARGO_TARGET_DIR) return resolve(env.CARGO_TARGET_DIR);
	const declared = declaredTargetDir(root);
	if (declared) return isAbsolute(declared) ? declared : join(root, declared);
	return join(root, ".cache", "cargo-target");
}

function declaredTargetDir(root) {
	try {
		const config = readFileSync(join(root, ".cargo", "config.toml"), "utf8");
		return config.match(/^\s*target-dir\s*=\s*"([^"]+)"/m)?.[1] ?? null;
	} catch {
		return null;
	}
}

export function tractorBinaryPath(root, env = process.env) {
	return join(
		resolveCargoTargetDir(root, env),
		"release",
		process.platform === "win32" ? "tractor.exe" : "tractor",
	);
}

export function agentWasmPath(root, env = process.env) {
	return join(resolveCargoTargetDir(root, env), "wasm32-wasip1", "release", "agent.wasm");
}
