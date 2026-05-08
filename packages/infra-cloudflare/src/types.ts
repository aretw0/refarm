export interface ServiceManifest {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly ciSecrets: readonly string[];
}

export type CloudflareProvisionResourceKind = "r2-bucket" | "secret" | "worker";
export type CloudflareProvisionResourceAction = "ensure" | "set" | "deploy";

export interface CloudflareProvisionResource {
  readonly kind: CloudflareProvisionResourceKind;
  readonly action: CloudflareProvisionResourceAction;
  readonly name: string;
  readonly description: string;
  readonly secret?: boolean;
}

export interface CloudflareProvisionPlan {
  readonly provider: "cloudflare";
  readonly serviceId: string;
  readonly displayName: string;
  readonly resources: readonly CloudflareProvisionResource[];
  readonly ciSecrets: readonly string[];
}
