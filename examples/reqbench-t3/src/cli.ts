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
	createLiveRequirementsProviderFactory,
	createRequirementsCapability,
	createRequirementsCheckCapability,
	createRequirementsOrganizeCapability,
	createRequirementsPullCapability,
	reqCapabilityBundle,
	type RequirementsCapabilityOptions,
} from "./persona.js";
import { createRequirementsPlaybookCapability } from "./playbook.js";

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

/** Build login-detection signals from DGK_LOGIN_* env, or undefined if none set. These let the
 * analyst calibrate how `--live` detects that the SSO login finished, on the REAL system, from
 * the environment — no recompile. (Only some SSO flows need tuning; the defaults work for many.)
 *   DGK_LOGIN_URL_INCLUDES   — a substring the post-login URL must contain (e.g. a dashboard path)
 *   DGK_LOGIN_READY_SELECTOR — a CSS selector present only once authenticated
 *   DGK_LOGIN_COOKIE         — the session cookie name that appears once authenticated
 *   DGK_LOGIN_URL_PATTERN    — regex of "still logging in" URL fragments (default login|sso|auth|signin)
 */
function loginSignalsFromEnv():
	| { urlIncludes?: string; readySelector?: string; cookieNamed?: string; loginUrlPattern?: string }
	| undefined {
	const signals = {
		...(process.env.DGK_LOGIN_URL_INCLUDES
			? { urlIncludes: process.env.DGK_LOGIN_URL_INCLUDES }
			: {}),
		...(process.env.DGK_LOGIN_READY_SELECTOR
			? { readySelector: process.env.DGK_LOGIN_READY_SELECTOR }
			: {}),
		...(process.env.DGK_LOGIN_COOKIE ? { cookieNamed: process.env.DGK_LOGIN_COOKIE } : {}),
		...(process.env.DGK_LOGIN_URL_PATTERN
			? { loginUrlPattern: process.env.DGK_LOGIN_URL_PATTERN }
			: {}),
	};
	return Object.keys(signals).length > 0 ? signals : undefined;
}

/**
 * `dgk` - the T3 POC CLI (result mode). Neutral blocks
 * (discover/pull/enrich/correct/analyze/vault) underneath; ONE persona verb
 * (`requirements`) on top. Mounting is declarative so this example is just its persona.
 */
export function buildReqbenchHost(options: ReqbenchHostOptions = {}): CapabilityHost {
	const command = resolveCommand(options);
	// A holder so the `playbook:run` verb's dispatch can resolve the host's OWN registry lazily
	// (at run time) — the playbook verb is itself in that registry, so it can't reference the
	// host until it's built.
	let host: CapabilityHost;
	host = defineCapabilityHost({
		id: "examples/reqbench-t3",
		command,
		description: "Digital Gardening Kit - requirements bench",
		version: "0.0.0",
		capabilities: () => {
			const { deps, records, sourceProvider, vaultSurface } = reqCapabilityBundle(options);
			const loginSignals = loginSignalsFromEnv();
			return {
				deps,
				extensions: [
					createRequirementsCapability(records),
					// Route pulled requirements to their PARA areas (taxonomy-as-data via vault:v1).
					// The bundle injects the (sovereign) vault surface — the verb never picks one.
					createRequirementsOrganizeCapability(records, vaultSurface),
					// Validate the corpus against the analyst's gates (quality:v1 note gates).
					createRequirementsCheckCapability(records),
					// The real ingest step: `requirements-pull <system>` LOGS IN then materializes
					// + ingests + persists, so the journey (discover → pull → analyze/MOC) runs as
					// commands. It reads the analyst's declared session from the SAME ledger the
					// source provider uses, so a still-valid session is honored (login-garantido).
					createRequirementsPullCapability(records, sourceProvider, {
						sourcesConfigPath: options.sourcesConfigPath,
						// `--live` wiring: the framework's browser-login driver, configured by env so
						// the analyst just sets DGK_CHROME_PATH / DGK_SESSION_DIR (no code). Absent
						// env still works — the factory finds Chrome via CHROME_PATH / default lookup.
						liveProviderFactory: createLiveRequirementsProviderFactory({
							sourcesConfigPath: options.sourcesConfigPath,
							chromePath: process.env.DGK_CHROME_PATH,
							sessionDir: process.env.DGK_SESSION_DIR,
							headless: process.env.DGK_HEADLESS === "1",
							// Login-detection knobs — tune these on the real SSO WITHOUT recompiling, so a
							// login that hangs (auth-in-the-URL) or false-positives (an auth interstitial
							// already on the ALM host) can be fixed from the environment. See the README.
							...(loginSignals ? { loginSignals } : {}),
							...(process.env.DGK_LOGIN_TIMEOUT_MS
								? { loginTimeoutMs: Number(process.env.DGK_LOGIN_TIMEOUT_MS) }
								: {}),
						}),
					}),
					// DOGFOOD: `playbook-run <name>` runs the analyst's journey as a declarative
					// playbook (`.dgk/*.playbook.json`) via the generic engine, driving the verbs
					// above in-process. One framework verb → also an agent tool for free.
					createRequirementsPlaybookCapability(host),
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
	return host;
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
