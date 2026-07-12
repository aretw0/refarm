#!/usr/bin/env node
import {
	createHostCommandResolver,
	defineCapabilityApp,
	defineCapabilityHost,
	HostCommandOptions,
	type CapabilityHost,
} from "@refarm.dev/capability-host";
import { createLocalRecordsAppDefaults } from "@refarm.dev/capability-host/node";

import {
	createRequirementsCapability,
	reqCapabilityBundle,
	type RequirementsStateOptions,
} from "./persona.js";

export const DGK_REQUIREMENTS_STATE_PATH_ENV = "DGK_REQUIREMENTS_STATE_PATH";
export const DGK_COMMAND = "dgk";

const requirementsAppDefaults = createLocalRecordsAppDefaults({
	appId: DGK_COMMAND,
	envKey: DGK_REQUIREMENTS_STATE_PATH_ENV,
	fileName: "requirements.manifest.json",
});
export const defaultRequirementsStatePath = requirementsAppDefaults.statePath;
export interface ReqbenchHostOptions extends RequirementsStateOptions, HostCommandOptions {}

const resolveCommand = createHostCommandResolver({ defaultCommand: DGK_COMMAND });

/**
 * `dgk` - the T3 POC CLI (result mode). Neutral blocks
 * (discover/pull/enrich/correct/analyze/vault) underneath; ONE persona verb
 * (`requirements`) on top. Mounting is declarative so this example is just its persona.
 */
export function buildReqbenchHost(options: ReqbenchHostOptions = {}): CapabilityHost {
	const command = resolveCommand(options);
	return defineCapabilityHost({
		id: "examples/reqbench-t3",
		command,
		description: "Digital Gardening Kit - requirements bench",
		version: "0.0.0",
		capabilities: () => {
			const { deps, records } = reqCapabilityBundle(options);
			return {
				deps,
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
					readySummary: ({ total }) => `Requirements bench has ${total} reviewed requirements.`,
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
			description: `Serve ${command} requirements verbs over HTTP (their transports.http routes)`,
			openApiPath: "/docs/openapi.json",
			openApiTitle: `${command} Requirements Bench API`,
		},
	});
}

export const reqbenchApp = defineCapabilityApp<ReqbenchHostOptions>({
	host: buildReqbenchHost,
	defaultOptions: requirementsAppDefaults.defaultOptions,
});

export const buildRegistry = reqbenchApp.registry;
export const buildRequirementsBaseModel = reqbenchApp.baseModel;
export const buildProgram = reqbenchApp.program;
export const serveReqbench = reqbenchApp.serve;

void reqbenchApp.runCli(import.meta.url, {
	compiledFileName: "cli.js",
});
