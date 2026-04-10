import type { UserConfig } from 'vitest/config';
import type { UserConfig as ViteUserConfig } from 'vite';

export function getAliases(root: string): Record<string, string>;
export const wasmBrowserHeaders: Record<string, string>;
export const wasmBrowserBaseConfig: ViteUserConfig;
export function withWasmBrowserConfig(overrides?: ViteUserConfig): ViteUserConfig;
export const baseConfig: UserConfig;
export default baseConfig;
