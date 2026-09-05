#!/usr/bin/env node
import {
	buildTrustedPublishingPlan,
	parseTrustedPublishingPlanArgs,
	printTrustedPublishingPlan,
} from "./trusted-publishing-plan.mjs";

try {
	const options = parseTrustedPublishingPlanArgs(process.argv.slice(2));
	const plan = buildTrustedPublishingPlan(options);
	printTrustedPublishingPlan(plan, options.json);
	if (!plan.ok) process.exit(1);
} catch (error) {
	console.error(`[trusted-publishing] ${error instanceof Error ? error.message : String(error)}`);
	process.exit(1);
}
