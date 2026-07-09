/** @module Interface refarm:plugin/tractor-bridge@0.1.0 **/
export function storeNode(node: JsonLdNode): NodeId;
export function getNode(id: NodeId): JsonLdNode;
export function queryNodes(nodeType: string, limit: number): Array<JsonLdNode>;
export function requestPermission(capability: string, reason: string): boolean;
export function getIdentity(): IdentityInfo;
export function getPluginApi(apiName: string): NodeId;
export function callPlugin(pluginId: NodeId, verb: string, inputJson: string): string;
export function emitTelemetry(event: string, payload: string | undefined): void;
export type JsonLdNode = import('./refarm-plugin-types.js').JsonLdNode;
export type NodeId = import('./refarm-plugin-types.js').NodeId;
export type PluginError = import('./refarm-plugin-types.js').PluginError;
export type IdentityInfo = import('./refarm-plugin-types.js').IdentityInfo;
