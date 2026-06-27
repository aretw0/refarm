import {
	buildRefarmCapabilityIndex,
	type RefarmCapabilityDescriptor,
	type RefarmCapabilityPolicyState,
} from "@refarm.dev/cli/capability-index";
import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/cli/json-output";
import chalk from "chalk";
import { Command } from "commander";

interface CapabilitiesOptions {
	json?: boolean;
	tag?: string[];
	state?: RefarmCapabilityPolicyState[];
}

function collectOption(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

function matchesTags(
	capability: RefarmCapabilityDescriptor,
	tags: readonly string[],
): boolean {
	if (tags.length === 0) return true;
	const capabilityTags = new Set(capability.tags);
	return tags.every((tag) => capabilityTags.has(tag));
}

function matchesStates(
	capability: RefarmCapabilityDescriptor,
	states: readonly RefarmCapabilityPolicyState[],
): boolean {
	if (states.length === 0) return true;
	return states.includes(capability.policy.state);
}

function formatCapabilityRows(
	capabilities: readonly RefarmCapabilityDescriptor[],
): string {
	const lines = [chalk.bold("Refarm capabilities")];
	for (const capability of capabilities) {
		lines.push(
			`${capability.id} ${chalk.dim(`[${capability.provider.kind}]`)}`,
		);
		lines.push(`  ${capability.description}`);
		if (capability.activation.command) {
			lines.push(chalk.dim(`  command: ${capability.activation.command}`));
		}
		if (capability.activation.sdk) {
			lines.push(chalk.dim(`  sdk:     ${capability.activation.sdk}`));
		}
		lines.push(
			chalk.dim(
				`  policy:  ${capability.policy.state}; tags: ${capability.tags.join(", ")}`,
			),
		);
	}
	return lines.join("\n");
}

export function createCapabilitiesCommand(): Command {
	return new Command("capabilities")
		.description("List compact Refarm capability descriptors for consumers")
		.option("--json", "Output machine-readable capability index")
		.option("--tag <tag>", "Filter by tag", collectOption, [])
		.option(
			"--state <state>",
			"Filter by policy state (planned, governed, proven)",
			collectOption,
			[],
		)
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm capabilities",
				"  $ refarm capabilities --tag daily-driver",
				"  $ refarm capabilities --state planned --json",
				"  $ refarm capabilities --json",
				"",
				"Notes:",
				"  This command is static and cheap. It reports compact descriptors, not full instructions.",
				"  Use package exports such as @refarm.dev/cli/capability-index when embedding Refarm.",
			].join("\n"),
		)
		.action((options: CapabilitiesOptions) => {
			const index = buildRefarmCapabilityIndex();
			const tags = options.tag ?? [];
			const states = options.state ?? [];
			const capabilities = index.capabilities.filter((capability) =>
				matchesTags(capability, tags) && matchesStates(capability, states),
			);
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "capabilities",
						operation: "index",
						extra: {
							schemaVersion: index.schemaVersion,
							count: capabilities.length,
							filter: { tags, states },
							capabilities,
						},
					}),
				);
				return;
			}
			console.log(formatCapabilityRows(capabilities));
		});
}

export const capabilitiesCommand = createCapabilitiesCommand();
