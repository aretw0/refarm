#!/usr/bin/env node
import { runBootstrapPreflightCli } from "./bootstrap-publish-preflight.mjs";

if (!globalThis.__REFARM_BOOTSTRAP_PREFLIGHT_TEST__) {
	process.exitCode = runBootstrapPreflightCli();
}
