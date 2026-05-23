export type PackageManagerName = "pnpm" | "npm" | "yarn" | "bun";

export interface PackageManagerOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
}

export interface PackageScriptCommandOptions extends PackageManagerOptions {
    cwd: string;
    script: string;
    repoRoot?: string;
}

export interface PackageScriptCommand {
    packageManager: PackageManagerName;
    command: string;
    args: string[];
    display: string;
}

export interface PackageCommandString {
    packageManager: PackageManagerName;
    command: string;
    display: string;
}

export interface PackageBinaryCommand {
    packageManager: PackageManagerName;
    command: string;
    args: string[];
    display: string;
}

export interface PackageSpawnCommand {
    packageManager: PackageManagerName;
    command: string;
    args: string[];
    display: string;
}

export interface PackageManagerOverrideDiagnostic {
    name: "REFARM_PACKAGE_MANAGER";
    value: string;
    valid: readonly PackageManagerName[];
}

export const PACKAGE_MANAGERS: readonly PackageManagerName[];

export function parsePackageManager(value: unknown): PackageManagerName | null;

export function packageManagerOverrideDiagnostic(
    env?: Record<string, string | undefined>,
): PackageManagerOverrideDiagnostic | null;

export function detectPackageManager(options?: PackageManagerOptions): PackageManagerName;

export function createPackageScriptCommand(
    options: PackageScriptCommandOptions,
): PackageScriptCommand;

export function packageScriptCommand(
    script: string,
    options?: PackageManagerOptions,
): PackageCommandString;

export function packageInstallCommand(
    options?: PackageManagerOptions,
): PackageCommandString;

export function packageFrozenInstallCommand(
    options?: PackageManagerOptions,
): PackageSpawnCommand;

export function packagePublishDryRunCommand(
    options?: PackageManagerOptions,
): PackageCommandString;

export function packageBinaryCommand(
    binary: string,
    args?: string[],
    options?: PackageManagerOptions,
): PackageBinaryCommand;
