import { describe, expect, it } from "vitest";
import type { ManagedServicePlan, ProviderProvisionPlan } from "./index.js";

interface ExampleServicePlan
	extends ManagedServicePlan<
		"example-service",
		{
			readonly kind: "artifact-storage";
			readonly name: string;
			readonly description: string;
		},
		"EXAMPLE_URL"
	> {
	readonly team: string;
}

describe("infra planning contracts", () => {
	it("separates provider-neutral requirements from provider materialization", () => {
		const servicePlan = {
			serviceId: "example-service",
			displayName: "Example Service",
			team: "garden",
			requirements: [
				{
					kind: "artifact-storage",
					name: "artifact-store",
					description: "Durable artifact storage",
				},
			],
			ciSecrets: ["EXAMPLE_URL"],
		} satisfies ExampleServicePlan;

		const providerPlan = {
			provider: "example-provider",
			serviceId: servicePlan.serviceId,
			displayName: servicePlan.displayName,
			servicePlan,
			resources: [
				{
					kind: "bucket",
					action: "ensure",
					name: "example-bucket",
					description: "Concrete bucket for artifacts",
				},
			],
			ciSecrets: servicePlan.ciSecrets,
		} satisfies ProviderProvisionPlan<"example-provider", ExampleServicePlan>;

		expect(providerPlan.servicePlan.requirements).toHaveLength(1);
		expect(providerPlan.resources).toEqual([
			{
				kind: "bucket",
				action: "ensure",
				name: "example-bucket",
				description: "Concrete bucket for artifacts",
			},
		]);
	});
});
