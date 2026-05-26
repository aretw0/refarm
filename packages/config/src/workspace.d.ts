export interface WorkspacePackageOptions {
    includeRoot?: boolean;
}

export function changedFilePathsFromGitStatus(status: string): string[];

export function affectedWorkspacePackagesFromGitStatus(
    root: string,
    status: string,
    options?: WorkspacePackageOptions,
): string[];

export function findWorkspacePackageForPath(
    root: string,
    changedPath: string,
    options?: WorkspacePackageOptions,
): string | null;
