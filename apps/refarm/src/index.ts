#!/usr/bin/env node

import {
	isModuleResolutionError,
	renderBootstrapFailure,
} from "./bootstrap-preflight.js";

try {
	await import("./cli-main.js");
} catch (error) {
	if (!isModuleResolutionError(error)) throw error;
	renderBootstrapFailure(error);
	process.exitCode = 1;
}
