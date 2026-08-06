export interface WorkspacePackageOptions {
    includeRoot?: boolean;
}

export function changedFilePathsFromGitStatus(status: string): string[];

export function changedFilePathsFromGitNameOnly(output: string): string[];

export function affectedWorkspacePackagesFromChangedPaths(
    root: string,
    changedPaths: string[],
    options?: WorkspacePackageOptions,
): string[];

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

export function findWorkspaceRoot(startDir?: string): string;

/** Whether `dir` is a workspace root: `.git`, `pnpm-workspace.yaml`, or a `package.json`
 *  declaring `workspaces`. The exact predicate `findWorkspaceRoot` climbs by. */
export function hasWorkspaceRootMarker(dir: string): boolean;
