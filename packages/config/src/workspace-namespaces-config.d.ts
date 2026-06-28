export type WorkspaceNamespacePersistence = "versioned" | "ignored" | "ephemeral";
export type WorkspaceNamespaceAccess = "readOnly" | "readWrite" | "generated";

export interface DeclaredWorkspaceNamespaceConfig {
    id: string;
    path: string;
    absolutePath: string;
    owner: string;
    purpose: string;
    persistence: WorkspaceNamespacePersistence;
    access: WorkspaceNamespaceAccess;
}

export const WORKSPACE_NAMESPACE_PERSISTENCE: readonly WorkspaceNamespacePersistence[];
export const WORKSPACE_NAMESPACE_ACCESS: readonly WorkspaceNamespaceAccess[];
export function parseWorkspaceNamespacePersistence(value: unknown): WorkspaceNamespacePersistence | null;
export function parseWorkspaceNamespaceAccess(value: unknown): WorkspaceNamespaceAccess | null;
export function declaredWorkspaceNamespacesFromConfig(config: unknown, options?: {
    baseDir?: string;
}): DeclaredWorkspaceNamespaceConfig[];
export function declaredWorkspaceNamespaceFromConfig(config: unknown, namespacePath: string, options?: {
    baseDir?: string;
}): DeclaredWorkspaceNamespaceConfig | null;
