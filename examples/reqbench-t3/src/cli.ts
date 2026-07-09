#!/usr/bin/env node
import {
	defineCapabilityApp,
	defineCapabilityHost,
	type CapabilityHost,
} from "@refarm.dev/capability-host";
import { createLocalRecordsStatePathResolver } from "@refarm.dev/capability-host/node";

import {
	createRequirementsCapability,
	reqCapabilityDeps,
	reqRecordsDeps,
	type RequirementsStateOptions,
} from "./persona.js";

export const DGK_REQUIREMENTS_STATE_PATH_ENV = "DGK_REQUIREMENTS_STATE_PATH";

export const defaultRequirementsStatePath = createLocalRecordsStatePathResolver({
	appId: "dgk",
	envKey: DGK_REQUIREMENTS_STATE_PATH_ENV,
	fileName: "requirements.manifest.json",
});

/**
 * `dgk` - the T3 POC CLI (result mode). Neutral blocks
 * (discover/pull/enrich/correct/analyze/vault) underneath; ONE persona verb
 * (`requirements`) on top. Mounting is declarative so this example is just its persona.
 */
export function buildReqbenchHost(
	options: RequirementsStateOptions = {},
): CapabilityHost {
	return defineCapabilityHost({
		id: "examples/reqbench-t3",
		command: "dgk",
		description: "Digital Gardening Kit - requirements bench",
		version: "0.0.0",
		capabilities: () => {
			const records = reqRecordsDeps(options);
			return {
				deps: reqCapabilityDeps(undefined, records),
				extensions: [createRequirementsCapability(records)],
			};
		},
		operatorStatus: {
			summary: "Show requirements bench operator status",
			httpPath: "/requirements/status",
			primaryVerb: {
				name: "requirements",
				subject: "Requirements bench",
				actionId: "open-requirements",
				intent: "requirements:open",
			},
			units: ({ recordReviewQueueUnit }) => [
				recordReviewQueueUnit({
					id: "requirements",
					label: "Requirements",
					reviewedState: "reviewed",
					totalLabel: "requirements",
					pendingLabel: "needs review",
					pendingSummary: ({ total, pending }) =>
						`Requirements bench has ${total} requirements; ${pending} requirement needs review.`,
					readySummary: ({ total }) =>
						`Requirements bench has ${total} reviewed requirements.`,
					pendingCorrection: {
						actionId: "review-draft-requirement",
						label: "Review the draft requirement",
						intent: "requirements:review",
						targetState: "reviewed",
					},
				}),
			],
		},
		serve: {
			defaultPort: 4321,
			description: "Serve dgk requirements verbs over HTTP (their transports.http routes)",
		},
	});
}

const reqbenchApp = defineCapabilityApp<RequirementsStateOptions>({
	host: buildReqbenchHost,
	defaultOptions: () => ({ statePath: defaultRequirementsStatePath() }),
});

export const buildRegistry = reqbenchApp.registry;
export const buildRequirementsBaseModel = reqbenchApp.baseModel;
export const buildProgram = reqbenchApp.program;
export const serveReqbench = reqbenchApp.serve;

void reqbenchApp.runCli(import.meta.url, {
	compiledFileName: "cli.js",
});
