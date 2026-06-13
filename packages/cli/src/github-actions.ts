import { spawnSync } from "node:child_process";

export interface GitHubActionsSecretOptions {
	cwd?: string;
	executable?: string;
}

export function setGitHubActionsSecret(
	name: string,
	value: string,
	options: GitHubActionsSecretOptions = {},
): void {
	const executable = options.executable ?? "gh";
	const result = spawnSync(executable, ["secret", "set", name], {
		cwd: options.cwd,
		input: value,
		encoding: "utf-8",
		stdio: ["pipe", "pipe", "pipe"],
	});

	if (result.status !== 0) {
		const message =
			result.stderr?.trim() ||
			result.stdout?.trim() ||
			result.error?.message ||
			`${executable} secret set ${name} failed`;
		throw new Error(message);
	}
}
