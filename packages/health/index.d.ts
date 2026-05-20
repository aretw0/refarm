export interface HealthIssue {
    file?: string;
    package?: string;
    type: string;
    entry?: string;
    path?: string;
}

export interface ResolutionStatus {
    package: string;
    mode: string;
}

export interface ProjectAuditResult {
    git: HealthIssue[];
    builds: HealthIssue[];
    alignment: HealthIssue[];
}

export interface FileSystemAuditResult {
    git: HealthIssue[];
    structure: {
        isDirectory: boolean;
        modifiedAt: string;
        size: number;
    };
}

export interface FileSystemAuditorOptions {
    ignoredGitVisibilityPatterns?: string[];
}

export interface ProjectAuditorOptions {
    title?: string;
    workspaceRoots?: string[];
    exemptPackageIds?: string[];
}

export class HealthCore {
    constructor(graphContext?: unknown);
    register(auditor: { id: string; audit(context?: unknown): Promise<unknown> }): void;
    loadPolicy(policyNodeId: string): Promise<unknown>;
    audit(requestedAuditors?: string[] | null, policyId?: string | null): Promise<unknown>;
    checkResolutionStatus(): Promise<ResolutionStatus[]>;
}

export class FileSystemAuditor {
    constructor(options?: FileSystemAuditorOptions);
    readonly id: "generic_fs";
    readonly title: string;
    audit(options?: { rootDir?: string; searchPath?: string }): Promise<FileSystemAuditResult | { error: string }>;
    checkGitVisibility(rootDir: string, targetPath: string): Promise<HealthIssue[]>;
    analyzeStructure(targetPath: string): Promise<FileSystemAuditResult["structure"]>;
}

export class ProjectAuditor {
    constructor(options?: ProjectAuditorOptions);
    readonly id: "project";
    readonly title: string;
    audit(context?: {
        rootDir?: string;
        workspaceRoots?: string[];
        exemptPackageIds?: string[];
        policy?: ProjectAuditorOptions;
        generic_fs?: { git?: HealthIssue[] };
    }): Promise<ProjectAuditResult>;
    checkBuildConfigs(rootDir: string, options?: ProjectAuditorOptions): Promise<HealthIssue[]>;
    checkPackageAlignment(rootDir: string, options?: ProjectAuditorOptions): Promise<HealthIssue[]>;
    checkResolutionStatus(rootDir: string, options?: ProjectAuditorOptions): Promise<ResolutionStatus[]>;
}

export class RefarmProjectAuditor extends ProjectAuditor {
    constructor(options?: ProjectAuditorOptions);
}
//# sourceMappingURL=index.d.ts.map
