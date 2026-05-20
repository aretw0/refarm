import { existsSync } from "node:fs";

/** True when running inside a Docker container or devcontainer.
 *  Localhost ports may not be reachable from the host browser. */
export function isContainer(): boolean {
	if (existsSync("/.dockerenv")) return true;
	if (process.env["REMOTE_CONTAINERS"] || process.env["VSCODE_REMOTE_CONTAINERS_SESSION"]) return true;
	if (process.env["CODESPACES"]) return true;
	return false;
}

/** True when running inside WSL1 or WSL2 (Windows Subsystem for Linux). */
export function isWsl(): boolean {
	return process.platform === "linux" &&
		(process.env["WSL_DISTRO_NAME"] !== undefined || process.env["WSL_INTEROP"] !== undefined);
}

/** True when a standard CI environment variable is detected. */
export function isCI(): boolean {
	return Boolean(process.env["CI"] || process.env["GITHUB_ACTIONS"] || process.env["CIRCLECI"]);
}

/** True when stdout is connected to an interactive TTY. */
export function hasTty(): boolean {
	return Boolean(process.stdout.isTTY);
}
