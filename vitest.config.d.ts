export declare const getAliases: (root: string) => Record<string, string>;
export declare const baseConfig: {
    test: {
        globals: boolean;
        environment: string;
        coverage: {
            provider: "v8";
            reporter: string[];
            exclude: string[];
        };
        include: string[];
        exclude: string[];
        testTimeout: number;
        hookTimeout: number;
    };
    resolve: {
        alias: Record<string, string>;
    };
};
declare const _default: import("vite").UserConfig;
export default _default;
//# sourceMappingURL=vitest.config.d.ts.map