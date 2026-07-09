/** @module Interface refarm:plugin/integration@0.1.0 **/
export function setup(): void;
export function ingest(): number;
export function push(payload: JsonLdNode): void;
export function teardown(): void;
export function getHelpNodes(): Array<JsonLdNode>;
export function metadata(): PluginMetadata;
export function onEvent(event: string, payload: string | undefined): void;
export function respond(payload: string): string;
export type JsonLdNode = import('./refarm-plugin-types.js').JsonLdNode;
export type PluginError = import('./refarm-plugin-types.js').PluginError;
export type PluginMetadata = import('./refarm-plugin-types.js').PluginMetadata;
