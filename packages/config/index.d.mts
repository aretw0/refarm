/**
 * Common configuration utility for Refarm.
 * Implements a pluggable source system with Strategic Bootstrap and prioritized merging.
 */
export function findRefarmRoot(startDir?: string): string;
/**
 * Synchronous loader (JSON + ENV)
 */
export function loadConfig(root?: string): any;
/**
 * Asynchronous loader (Full Sovereignty)
 */
export function loadConfigAsync(root?: string): Promise<any>;
declare namespace _default {
    export { findRefarmRoot };
    export { loadConfig };
    export { loadConfigAsync };
}
export default _default;
//# sourceMappingURL=index.d.mts.map