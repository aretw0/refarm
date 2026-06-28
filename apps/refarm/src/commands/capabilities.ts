import {
	buildRefarmCapabilityIndex,
	buildReferenceDriverSupplyMap,
	type RefarmCapabilityDescriptor,
	type RefarmCapabilityPolicyState,
	type ReferenceDriverSupplyMap,
} from "@refarm.dev/cli/capability-index";
import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/cli/json-output";
import chalk from "chalk";
import { Command } from "commander";

interface CapabilitiesOptions {
	json?: boolean;
	tag?: string[];
	state?: RefarmCapabilityPolicyState[];
	supply?: string;
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

function buildSupplyPayload(surface: string | undefined): {
	surface: "reference-driver";
	map: ReferenceDriverSupplyMap;
} | undefined {
	if (!surface) return undefined;
	if (surface !== "reference-driver") {
		throw new Error(
			`Unsupported capability supply surface: ${surface}. Supported: reference-driver.`,
		);
	}
	return {
		surface,
		map: buildReferenceDriverSupplyMap(),
	};
}

function formatReferenceDriverSupplyMap(supplyMap: ReferenceDriverSupplyMap): string {
	const lines = ["", chalk.bold("Supply posture")];
	for (const entry of supplyMap.entries) {
		lines.push(`${entry.capabilityId} ${chalk.dim(`[${entry.policyState}]`)}`);
		for (const target of entry.targets) {
			lines.push(
				chalk.dim(
					`  ${target.status}: ${target.channel} ${target.name}`,
				),
			);
		}
	}
	return lines.join("\n");
}

export function createCapabilitiesCommand(): Command {
	return new Command("capabilities")
		.description("List compact Refarm capability descriptors for consumers")
		.option("--json", "Output machine-readable capability index")
		.option("--tag <tag>", "Filter by tag", collectOption, [])
		.option(
			"--supply <surface>",
			"Include supply posture for a surface (reference-driver)",
		)
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
				"  $ refarm capabilities --tag reference-driver --supply reference-driver --json",
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
			const supply = buildSupplyPayload(options.supply);
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
							supply,
						},
					}),
				);
				return;
			}
			const output = [
				formatCapabilityRows(capabilities),
				...(supply ? [formatReferenceDriverSupplyMap(supply.map)] : []),
			].join("\n");
			console.log(output);
		});
}

export const capabilitiesCommand = createCapabilitiesCommand();
