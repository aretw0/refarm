/** @module Interface refarm:plugin/types@0.1.0 **/
export type JsonLdNode = string;
export type NodeId = string;
export type PluginError = PluginErrorNotPermitted | PluginErrorNotFound | PluginErrorInvalidSchema | PluginErrorInternal;
export interface PluginErrorNotPermitted {
  tag: 'not-permitted',
  val: string,
}
export interface PluginErrorNotFound {
  tag: 'not-found',
  val: NodeId,
}
export interface PluginErrorInvalidSchema {
  tag: 'invalid-schema',
  val: string,
}
export interface PluginErrorInternal {
  tag: 'internal',
  val: string,
}
export interface IdentityInfo {
  identityType: string,
  storageTier: string,
  identifier: string,
}
export interface PluginMetadata {
  name: string,
  version: string,
  description: string,
  supportedTypes: Array<string>,
  requiredCapabilities: Array<string>,
}
