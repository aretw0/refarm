#!/usr/bin/env node

import { isModuleResolutionError, renderBootstrapFailure } from "./bootstrap-preflight.js";

// The substrate (@refarm.dev/config, the Rust host) has NO default config-dir name —
// it reads SOVEREIGN_CONFIG_DIR and fails up if unset. This app IS the refarm brand,
// so IT chooses ".refarm" and injects it here, at the earliest boot point, before any
// config read. An operator may still override the selector. This is the one place the
// brand dir name lives; the substrate never assumes it.
if (!process.env.SOVEREIGN_CONFIG_DIR?.trim()) {
	process.env.SOVEREIGN_CONFIG_DIR = ".refarm";
}

try {
	await import("./cli-main.js");
} catch (error) {
	if (!isModuleResolutionError(error)) throw error;
	renderBootstrapFailure(error);
	process.exitCode = 1;
}
