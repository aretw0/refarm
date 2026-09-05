#!/usr/bin/env node
import {
	buildTrustedPublishingPlan,
	parseTrustedPublishingPlanArgs,
	printTrustedPublishingPlan,
} from "./trusted-publishing-plan.mjs";

export function trustedPublishingPlanFromArgs(argv) {
	const options = parseTrustedPublishingPlanArgs(argv);
	return { options, plan: buildTrustedPublishingPlan(options) };
}

export function runTrustedPublishingPlanCli(argv = process.argv.slice(2)) {
	try {
		const { options, plan } = trustedPublishingPlanFromArgs(argv);
		printTrustedPublishingPlan(plan, options.json);
		return plan.ok ? 0 : 1;
	} catch (error) {
		console.error(`[trusted-publishing] ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	}
}

if (!globalThis.__REFARM_TRUSTED_PUBLISHING_PLAN_TEST__) {
	process.exitCode = runTrustedPublishingPlanCli();
}
