export type { ModelScope } from "./model-routing.js";
export {
    MODEL_SCOPES,
    defaultModelForProvider,
    defaultModelForScope,
    inferProviderFromModelId,
    isModelScope,
} from "./model-routing.js";

export function findRefarmRoot(startDir?: string): string;
export function loadConfig(root?: string): any;
export function loadConfigAsync(root?: string): Promise<any>;

declare const _default: {
    findRefarmRoot: typeof findRefarmRoot;
    loadConfig: typeof loadConfig;
    loadConfigAsync: typeof loadConfigAsync;
};
export default _default;
