/**
 * Silo: The Context and Secret Provisioner
 * Stores and resolves essential "nutrients" (tokens, env vars, context)
 * for Refarm processes in an environment-agnostic way.
 */
export class SiloCore {
    constructor(config: any);
    config: any;
    /**
     * Resolve all context tokens based on current config and environment
     */
    resolve(): Promise<Map<any, any>>;
    /**
     * Provision the context to a specific target (e.g., GITHUB_ENV, Process, or JSON)
     */
    provision(targetType?: string): Promise<{}>;
    bootstrapIdentity(): Promise<any>;
    toGitHubEnv(tokens: any): string;
}
export default SiloCore;
//# sourceMappingURL=index.d.ts.map