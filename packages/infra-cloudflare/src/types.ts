import type {
	ManagedServicePlan,
	ProviderProvisionPlan,
	ProviderProvisionResource,
} from "@refarm.dev/infra-contract-v1";

export interface ServiceManifest {
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
	readonly ciSecrets: readonly string[];
}

export type CloudflareProvisionResourceKind = "r2-bucket" | "secret" | "worker";
export type CloudflareProvisionResourceAction = "ensure" | "set" | "deploy";

export interface CloudflareProvisionResource
	extends ProviderProvisionResource<
		CloudflareProvisionResourceKind,
		CloudflareProvisionResourceAction
	> {}

export interface CloudflareProvisionPlan<
	ServicePlan extends ManagedServicePlan = ManagedServicePlan,
> extends ProviderProvisionPlan<
		"cloudflare",
		ServicePlan,
		CloudflareProvisionResource
	> {}
