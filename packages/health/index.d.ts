export interface HealthIssue {
    file?: string;
    package?: string;
    type: string;
    entry?: string;
    path?: string;
    category?: string;
    lines?: number;
    size?: number;
    allowed?: boolean;
    note?: string;
}

export interface ResolutionStatus {
    package: string;
    mode: string;
}

export interface ProjectAuditResult {
    git: HealthIssue[];
    builds: HealthIssue[];
    staleBuilds?: HealthIssue[];
    alignment: HealthIssue[];
    automations?: HealthIssue[];
    namespaceWarnings?: HealthIssue[];
    complexity?: HealthIssue[];
    complexitySummary?: ComplexityAuditResult;
    /** False when `rootDir` is not a project (see ProjectBaseResult) — builds,
     *  alignment, automations, and namespaceWarnings are all `[]` in that case,
     *  not "checked and clean". `git` still forwards generic_fs's own result. */
    applicable: boolean;
    /** Present only when `applicable` is false. */
    reason?: string;
}

export interface FileSystemAuditResult {
    git: HealthIssue[];
    structure: {
        isDirectory: boolean;
        modifiedAt: string;
        size: number;
    };
    /** False when `rootDir` is not a project (see ProjectBaseResult) — `git` is
     *  `[]` in that case because the check never ran, not because it ran clean. */
    applicable: boolean;
    /** Present only when `applicable` is false. */
    reason?: string;
}

export interface ProjectBaseResult {
    isProject: boolean;
    reason: string | null;
}

export interface FileSystemAuditorOptions {
    ignoredGitVisibilityPatterns?: string[];
}

export interface ProjectAuditorOptions {
    title?: string;
    workspaceRoots?: string[];
    exemptPackageIds?: string[];
    workspaceNamespaces?: Array<{
        path: string;
        owner?: string;
        purpose?: string;
        persistence?: string;
        access?: string;
    }>;
}

export interface ComplexityAuditorOptions {
    maxLines?: number;
    paths?: string[];
    files?: string[];
    allowedPatterns?: string[];
    allowedRules?: Array<{
        pattern: string;
        note: string;
    }>;
    reportLimit?: number;
}

export interface ComplexityAuditResult {
    ok: boolean;
    maxLines: number;
    reportLimit: number;
    findings: HealthIssue[];
    blockingFindings: HealthIssue[];
    allowedFindings: HealthIssue[];
    topBlockingFindings: HealthIssue[];
    topFindings: HealthIssue[];
    summaryByCategory: Record<string, {
        allowed: number;
        blocking: number;
        files: number;
        maxLines: number;
        totalLines: number;
    }>;
}

export interface ToolchainCheck {
    id: string;
    label: string;
    ok: boolean;
    required: boolean;
    path?: string;
    target?: string;
    command?: string;
    version?: string;
    stderr?: string;
}

export interface ToolchainPathCheckOptions {
    id: string;
    label?: string;
    path: string;
    executable?: boolean;
    required?: boolean;
}

export interface ToolchainCommandCheckOptions {
    id: string;
    label?: string;
    command: string;
    args?: string[];
    required?: boolean;
    shell?: boolean;
}

export interface ToolchainAnyCommandCheckOptions {
    id: string;
    label?: string;
    required?: boolean;
    candidates: Array<{
        command: string;
        args?: string[];
        shell?: boolean;
    }>;
}

export interface ToolchainDevcontainerMountOptions {
    id?: string;
    label?: string;
    nodeModulesPath?: string;
    devcontainerPath?: string;
    required?: boolean;
}

export interface ToolchainAuditorOptions {
    title?: string;
    pathChecks?: ToolchainPathCheckOptions[];
    commandChecks?: ToolchainCommandCheckOptions[];
    anyCommandChecks?: ToolchainAnyCommandCheckOptions[];
    devcontainerNodeModulesMount?: boolean | ToolchainDevcontainerMountOptions;
    platform?: NodeJS.Platform;
    spawnSync?: (...args: unknown[]) => { status: number | null; stdout?: string; stderr?: string };
    mountInfoReader?: () => Promise<string>;
}

export interface ToolchainAuditResult {
    ok: boolean;
    checks: ToolchainCheck[];
    missing: string[];
    mountIssues: Array<{
        id: string;
        path?: string;
        target?: string;
    }>;
}

/**
 * Distinguishes a PROJECT base (a git repository, or a directory with its own
 * package.json) from a NODE base (e.g. the operator's `~/.refarm` sovereign
 * root) — see src/project-base.js for the full rationale. FileSystemAuditor
 * and ProjectAuditor call this internally; it is exported for direct testing
 * and reuse by future project-shaped auditors.
 */
export function detectProjectBase(rootDir: string): ProjectBaseResult;

export class HealthCore {
    constructor(graphContext?: unknown);
    register(auditor: { id: string; audit(context?: unknown): Promise<unknown> }): void;
    loadPolicy(policyNodeId: string): Promise<unknown>;
    audit(
        requestedAuditors?: string[] | null,
        policyId?: string | null,
        options?: { rootDir?: string; configBase?: string },
    ): Promise<unknown>;
    checkResolutionStatus(rootDir?: string): Promise<ResolutionStatus[]>;
}

export class FileSystemAuditor {
    constructor(options?: FileSystemAuditorOptions);
    readonly id: "generic_fs";
    readonly title: string;
    audit(options?: { rootDir?: string; searchPath?: string }): Promise<FileSystemAuditResult | { error: string }>;
    checkGitVisibility(rootDir: string, targetPath: string): Promise<HealthIssue[]>;
    analyzeStructure(targetPath: string): Promise<FileSystemAuditResult["structure"]>;
}

export class ComplexityAuditor {
    constructor(options?: ComplexityAuditorOptions);
    readonly id: "complexity";
    readonly title: string;
    audit(context?: { rootDir?: string }): Promise<ComplexityAuditResult>;
    scan(rootDir: string): HealthIssue[];
}

export interface ConfigNodeAuditorOptions {
    /** A getNode/queryNodes face over the tractor graph; null → the auditor no-ops. */
    graphContext?: { getNode(id: string): Promise<unknown> } | null;
}

export interface ConfigNodeAuditResult {
    issues: HealthIssue[];
    note?: string;
}

export class ConfigNodeAuditor {
    constructor(options?: ConfigNodeAuditorOptions);
    readonly id: "config-node";
    readonly title: string;
    /**
     * `configBase` — the scope the graph node's OWNING DAEMON used, resolved by
     * the caller (see `resolveConfigNodeBase` in apps/refarm/src/commands/health.ts)
     * — takes priority over `rootDir` for the local `.refarm/config.json` half of
     * the comparison. `rootDir` remains a fallback for callers with no node-scope
     * concept of their own (e.g. a direct, single-root unit test).
     */
    audit(context?: { rootDir?: string; configBase?: string }): Promise<ConfigNodeAuditResult>;
}

export class ToolchainAuditor {
    constructor(options?: ToolchainAuditorOptions);
    readonly id: "toolchain";
    readonly title: string;
    audit(context?: { rootDir?: string; mountInfo?: string }): Promise<ToolchainAuditResult>;
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
    checkProjectAutomations(rootDir: string): HealthIssue[];
    checkWorkspaceNamespaces(rootDir: string, options?: ProjectAuditorOptions): HealthIssue[];
}

export class RefarmProjectAuditor extends ProjectAuditor {
    constructor(options?: ProjectAuditorOptions);
}
//# sourceMappingURL=index.d.ts.map
