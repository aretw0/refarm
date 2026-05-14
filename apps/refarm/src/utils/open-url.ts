import { execFile } from "node:child_process";

function resolveOpenCommand(url: string): [string, string[]] | null {
	if (process.platform === "darwin") return ["open", [url]];
	if (process.platform === "win32") return ["cmd", ["/c", "start", "", url]];

	// Linux — check for WSL Windows interop (not available in Docker devcontainers)
	if (process.env["WSL_DISTRO_NAME"] || process.env["WSL_INTEROP"]) {
		// wslview (wslu package) is the safe WSL browser opener
		return ["wslview", [url]];
	}

	// Plain Linux / devcontainer without WSL interop — xdg-open with low risk
	return ["xdg-open", [url]];
}

export function tryOpenUrl(url: string): void {
	const resolved = resolveOpenCommand(url);
	if (!resolved) return;
	const [bin, args] = resolved;
	try {
		// execFile pipes stdout/stderr to buffers — child output never reaches the terminal
		const child = execFile(bin, args, { timeout: 5000 }, () => {});
		// unref() lets Node exit even if the child is still alive (e.g. browser opening)
		child.unref();
	} catch {
		// best-effort — caller already printed the URL
	}
}
