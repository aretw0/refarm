export const CONFIG_NODE_SCHEMA: "refarm.config.node.v1";
export const CONFIG_NODE_KIND: "refarm/config";
export const CONFIG_NODE_DEFAULT_ID: "urn:refarm:config:workspace";
export const CONFIG_NODE_REDACTION: "<redacted>";
export const CONFIG_NODE_REDACTION_KEY_PATTERNS: readonly string[];

export interface ConfigNodeEvidence {
    readonly hashAlgorithm: "sha256";
    readonly configDigest: string;
    readonly redactedPaths: readonly string[];
    readonly source: string;
}

export interface ConfigNodeV1<TData = unknown> {
    readonly schema: typeof CONFIG_NODE_SCHEMA;
    readonly kind: typeof CONFIG_NODE_KIND;
    readonly id: string;
    readonly revision: string;
    readonly data: TData;
    readonly evidence: ConfigNodeEvidence;
    readonly boundaries: readonly string[];
}

export interface ConfigNodeOptions {
    readonly id?: string;
    readonly source?: string;
    readonly redactionKeyPatterns?: readonly string[];
}

export interface RedactedConfigResult<TData = unknown> {
    readonly value: TData;
    readonly redactions: readonly string[];
}

export function redactConfigForNode<TData = unknown>(
    config: TData,
    options?: Pick<ConfigNodeOptions, "redactionKeyPatterns">,
): RedactedConfigResult<TData>;

export function createConfigNode<TData = unknown>(
    config: TData,
    options?: ConfigNodeOptions,
): ConfigNodeV1<TData>;

export function configFromNode<TData = unknown>(node: ConfigNodeV1<TData>): TData;
export function loadConfigNode(root?: string, options?: ConfigNodeOptions): ConfigNodeV1;
export function loadConfigNodeAsync(root?: string, options?: ConfigNodeOptions): Promise<ConfigNodeV1>;
