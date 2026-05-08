export interface ServiceManifest {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
  readonly ciSecrets: readonly string[];
}
