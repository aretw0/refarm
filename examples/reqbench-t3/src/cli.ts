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
	createRequirementsPullCapability,
	reqCapabilityBundle,
	type RequirementsCapabilityOptions,
} from "./persona.js";

export const DGK_REQUIREMENTS_STATE_PATH_ENV = "DGK_REQUIREMENTS_STATE_PATH";
export const DGK_COMMAND = "dgk";

const requirementsAppDefaults = createLocalRecordsAppDefaults({
	appId: DGK_COMMAND,
	envKey: DGK_REQUIREMENTS_STATE_PATH_ENV,
	fileName: "requirements.manifest.json",
});
export const defaultRequirementsStatePath = requirementsAppDefaults.statePath;
export interface ReqbenchHostOptions extends RequirementsCapabilityOptions, HostCommandOptions {}

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
			const { deps, records, sourceProvider } = reqCapabilityBundle(options);
			return {
				deps,
				extensions: [
					createRequirementsCapability(records),
					// The real ingest step: `requirements-pull <system>` LOGS IN then materializes
					// + ingests + persists, so the journey (discover → pull → analyze/MOC) runs as
					// commands. It reads the analyst's declared session from the SAME ledger the
					// source provider uses, so a still-valid session is honored (login-garantido).
					createRequirementsPullCapability(records, sourceProvider, {
						sourcesConfigPath: options.sourcesConfigPath,
					}),
				],
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
