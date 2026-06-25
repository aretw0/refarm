import { SiloCore } from "./index.js";

/**
 * @typedef {Object} CollectContext
 * @property {(url: string) => void} tryOpenUrl
 * @property {import("@refarm.dev/prompt-contract-v1").OperatorChannel} [operator]
 */

/**
 * @typedef {Object} CredentialProvider
 * @property {string} id
 * @property {string} label
 * @property {string} namespace Reserved set: model | runtime | channel | publishing.
 * @property {(ctx: CollectContext) => Promise<string>} collect
 */

/**
 * @typedef {Object} SiloCollectResult
 * @property {string} id
 * @property {string} namespace
 * @property {boolean} stored
 */

/**
 * Collect a secret via the provider and persist it under provider.namespace.
 * @param {CredentialProvider} provider
 * @param {CollectContext} ctx
 * @param {SiloCore} [core]
 * @returns {Promise<SiloCollectResult>}
 */
export async function collectAndStore(provider, ctx, core = new SiloCore()) {
    const value = await provider.collect(ctx);
    await core.saveSecret(provider.namespace, provider.id, value);
    return { id: provider.id, namespace: provider.namespace, stored: true };
}
