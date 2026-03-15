export class SovereignHealth {
    /**
     * Runs all deterministic diagnostics.
     */
    audit(): Promise<{
        git: {
            file: string;
            type: string;
        }[];
        builds: {
            package: string;
            type: string;
        }[];
        alignment: {
            package: string;
            entry: any;
            type: string;
        }[];
    }>;
    /**
     * Detects if source files are being incorrectly ignored.
     */
    checkGitIgnores(): Promise<{
        file: string;
        type: string;
    }[]>;
    /**
     * Ensures all packages have a valid tsconfig.build.json
     */
    checkBuildConfigs(): Promise<{
        package: string;
        type: string;
    }[]>;
    /**
     * Verifies if main/module entry points point to dist/
     */
    checkPackageAlignment(): Promise<{
        package: string;
        entry: any;
        type: string;
    }[]>;
}
//# sourceMappingURL=index.d.ts.map