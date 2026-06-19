import {
	workspaceCanUseTurboAdapter as baseWorkspaceCanUseTurboAdapter,
	buildWorkspaceExecutionStatus as buildBaseWorkspaceExecutionStatus,
	type WorkspaceExecutionStatus as BaseWorkspaceExecutionStatus,
	type WorkspaceExecutionPackageManager,
} from "@refarm.dev/cli/workspace-execution";
import {
	detectPackageManager as detectSharedPackageManager,
	type PackageManagerName,
} from "@refarm.dev/config";
import { refarmCommand } from "./command-handoff.js";

export interface WorkspaceExecutionStatus extends Omit<BaseWorkspaceExecutionStatus, "cache"> {
	cache: {
		local: BaseWorkspaceExecutionStatus["cache"]["local"];
		remote: BaseWorkspaceExecutionStatus["cache"]["remote"] & {
			provisionCommand: string;
		};
	};
}

export function buildWorkspaceExecutionStatus(options: {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	packageManager?: PackageManagerName;
} = {}): WorkspaceExecutionStatus {
	const cwd = options.cwd ?? process.cwd();
	const env = options.env ?? process.env;
	const packageManager = options.packageManager ?? detectSharedPackageManager({ cwd, env });
	const baseStatus = buildBaseWorkspaceExecutionStatus({
		cwd,
		env,
		packageManager: packageManager as WorkspaceExecutionPackageManager,
	});
	return {
		...baseStatus,
		cache: {
			local: baseStatus.cache.local,
			remote: {
				...baseStatus.cache.remote,
				provisionCommand: refarmCommand([
					"provision",
					"cloudflare",
					"turbo-cache",
					"--dry-run",
					"--json",
				]),
			},
		},
	};
}

export function workspaceCanUseTurboAdapter(cwd = process.cwd()): boolean {
	return baseWorkspaceCanUseTurboAdapter(cwd);
}
