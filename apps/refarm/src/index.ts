#!/usr/bin/env node

import { isModuleResolutionError, renderBootstrapFailure } from "./bootstrap-preflight.js";

// The substrate (@refarm.dev/config, the Rust host) has NO default config-dir name —
// it reads SOVEREIGN_DIR and fails up if unset. This app IS the refarm brand,
// so IT chooses ".refarm" and injects it here, at the earliest boot point, before any
// config read. An operator may still override the selector. This is the one place the
// brand dir name lives; the substrate never assumes it.
if (!process.env.SOVEREIGN_DIR?.trim()) {
	process.env.SOVEREIGN_DIR = ".refarm";
}

try {
	// Called here rather than run as an import side effect, so that importing `cli-main.js` in a
	// unit test starts nothing and spawning this binary starts everything — including from inside a
	// vitest run, which the old `!process.env.VITEST` guard silently prevented.
	const { runCliMain } = await import("./cli-main.js");
	await runCliMain();
} catch (error) {
	if (!isModuleResolutionError(error)) throw error;
	renderBootstrapFailure(error);
	process.exitCode = 1;
}
