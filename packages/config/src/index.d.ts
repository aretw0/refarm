export function findRefarmRoot(startDir?: string): string;
export function loadConfig(root?: string): any;
export function loadConfigAsync(root?: string): Promise<any>;

declare const _default: {
    findRefarmRoot: typeof findRefarmRoot;
    loadConfig: typeof loadConfig;
    loadConfigAsync: typeof loadConfigAsync;
};
export default _default;
