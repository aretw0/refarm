import { buildJsonErrorEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { quoteCommandArg } from "@refarm.dev/cli/command-handoff";
import {
	isRuntimeSubscriptionModelProvider,
	isSubscriptionModelProvider,
} from "@refarm.dev/config";
import chalk from "chalk";
import { refarmCommand } from "../brand.js";
import {
	LOCAL_MODEL_JSON_COMMAND,
	MODEL_CURRENT_JSON_COMMAND,
	MODEL_PROVIDERS_JSON_COMMAND,
	SOW_INTERACTIVE_COMMAND,
	SOW_JSON_COMMAND,
} from "./credential-handoffs.js";
import { buildCurrentModelStatus, defaultModelDeps, type CurrentModelStatus } from "./model.js";

function subscriptionRuntimeUnsupportedCommands(status: CurrentModelStatus): string[] {
	return [
		MODEL_CURRENT_JSON_COMMAND,
		SOW_JSON_COMMAND,
		MODEL_PROVIDERS_JSON_COMMAND,
		refarmCommand(["sow", "--model", quoteCommandArg(status.current.ref), "--json"]),
		LOCAL_MODEL_JSON_COMMAND,
	];
}

function buildSubscriptionRuntimeUnsupportedEnvelope(status: CurrentModelStatus) {
	const nextCommands = subscriptionRuntimeUnsupportedCommands(status);
	return buildJsonErrorEnvelope({
		command: "ask",
		operation: "credentials",
		error: "model-subscription-runtime-unsupported",
		message:
			"The current model route uses subscription OAuth, but the runtime does not support subscription-backed model calls yet.",
		nextAction: nextCommands[0]!,
		nextActions: nextCommands,
		nextCommand: nextCommands[0],
		nextCommands,
		extra: {
			action: "ask",
			current: status.current,
			credential: status.credential,
			recommendations: [
				{
					diagnostic: "model-subscription-runtime-unsupported",
					severity: "failure",
					summary:
						"Subscription OAuth is stored for operator login, not as a runtime API credential.",
					action:
						"Configure an API-key provider, switch to a local model route, or add a subscription runtime adapter before using ask.",
					command: SOW_JSON_COMMAND,
				},
			],
			handoffs: {
				inspectCurrent: MODEL_CURRENT_JSON_COMMAND,
				interactive: SOW_INTERACTIVE_COMMAND,
				inspectProviders: MODEL_PROVIDERS_JSON_COMMAND,
				localNoKeyModel: LOCAL_MODEL_JSON_COMMAND,
			},
		},
	});
}

export function printSubscriptionRuntimeUnsupported(
	status: CurrentModelStatus,
	json: boolean,
): void {
	if (json) {
		printJson(buildSubscriptionRuntimeUnsupportedEnvelope(status));
		return;
	}
	console.error(
		chalk.red(
			"\n✗  Current model route uses subscription OAuth, but runtime calls do not support that yet.",
		),
	);
	if (status.credential.status) {
		console.error(chalk.dim(`   Stored credential: ${status.credential.status}`));
	}
	console.error(
		chalk.dim(
			"   This path needs an API-key provider, a local model route, or a subscription runtime adapter.",
		),
	);
	console.error(chalk.dim(`   Inspect route:       ${MODEL_CURRENT_JSON_COMMAND}`));
	console.error(chalk.dim(`   Reconfigure/login:   ${SOW_INTERACTIVE_COMMAND}`));
	console.error(chalk.dim(`   Local no-key route:   ${LOCAL_MODEL_JSON_COMMAND}`));
}

export async function currentSubscriptionRuntimeUnsupported(): Promise<CurrentModelStatus | null> {
	const tokens = await defaultModelDeps().loadTokens();
	const status = buildCurrentModelStatus(tokens);
	const defaultCredential = status.routeCredentials.default;
	if (!isSubscriptionModelProvider(status.current.provider)) return null;
	if (isRuntimeSubscriptionModelProvider(status.current.provider)) return null;
	if (defaultCredential.state === "missing" || defaultCredential.state === "not-required") {
		return null;
	}
	return status;
}
