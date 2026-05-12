export type ManagedResourceRequirementKind = string;
export type ProviderProvisionResourceKind = string;
export type ProviderProvisionResourceAction = string;

export interface ManagedResourceRequirement<
	Kind extends ManagedResourceRequirementKind = ManagedResourceRequirementKind,
> {
	readonly kind: Kind;
	readonly name: string;
	readonly description: string;
	readonly secret?: boolean;
}

export interface ManagedServicePlan<
	ServiceId extends string = string,
	Requirement extends ManagedResourceRequirement = ManagedResourceRequirement,
	CiSecret extends string = string,
> {
	readonly serviceId: ServiceId;
	readonly displayName: string;
	readonly requirements: readonly Requirement[];
	readonly ciSecrets: readonly CiSecret[];
}

export interface ProviderProvisionResource<
	Kind extends ProviderProvisionResourceKind = ProviderProvisionResourceKind,
	Action extends
		ProviderProvisionResourceAction = ProviderProvisionResourceAction,
> {
	readonly kind: Kind;
	readonly action: Action;
	readonly name: string;
	readonly description: string;
	readonly secret?: boolean;
}

export interface ProviderProvisionPlan<
	Provider extends string = string,
	ServicePlan extends ManagedServicePlan = ManagedServicePlan,
	Resource extends ProviderProvisionResource = ProviderProvisionResource,
> {
	readonly provider: Provider;
	readonly serviceId: ServicePlan["serviceId"];
	readonly displayName: string;
	readonly servicePlan: ServicePlan;
	readonly resources: readonly Resource[];
	readonly ciSecrets: ServicePlan["ciSecrets"];
}
