import { spawn } from "node:child_process";
import { splitCommandLine } from "./command-line.js";

export interface BrowserOpenSpec {
	command: string;
	args: string[];
	display: string;
}

export interface BrowserOpenResult {
	url: string;
	candidate: BrowserOpenSpec;
}

export interface ResolveBrowserOpenCandidatesOptions {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
}

export interface OpenHostBrowserUrlOptions
	extends ResolveBrowserOpenCandidatesOptions {
	run?: (candidate: BrowserOpenSpec) => Promise<void>;
}

export function resolveBrowserOpenSpec(
	url: string,
	platform: NodeJS.Platform = process.platform,
): BrowserOpenSpec {
	if (platform === "darwin") {
		return {
			command: "open",
			args: [url],
			display: `open ${url}`,
		};
	}

	if (platform === "win32") {
		return {
			command: "cmd",
			args: ["/c", "start", "", url],
			display: `cmd /c start "" ${url}`,
		};
	}

	return {
		command: "xdg-open",
		args: [url],
		display: `xdg-open ${url}`,
	};
}

export function resolveBrowserOpenCandidates(
	url: string,
	options: ResolveBrowserOpenCandidatesOptions = {},
): BrowserOpenSpec[] {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;

	if (platform === "darwin" || platform === "win32") {
		return [resolveBrowserOpenSpec(url, platform)];
	}

	const candidates: BrowserOpenSpec[] = [];
	const seen = new Set<string>();
	const add = (command: string, args: string[], display: string) => {
		const key = `${command}\0${args.join("\0")}`;
		if (seen.has(key)) return;
		seen.add(key);
		candidates.push({ command, args, display });
	};

	if (env.REFARM_BROWSER_OPEN_COMMAND) {
		const parts = splitBrowserOpenCommand(env.REFARM_BROWSER_OPEN_COMMAND);
		const [command, ...args] = parts;
		if (command) {
			add(
				command,
				[...args, url],
				`${env.REFARM_BROWSER_OPEN_COMMAND} ${url}`,
			);
		}
	}

	add(
		"sh",
		[
			"-lc",
			"for helper in /vscode/vscode-server/bin/linux-x64/*/bin/helpers/browser.sh \"$HOME\"/.vscode-server/bin/*/bin/helpers/browser.sh; do [ -x \"$helper\" ] && exec \"$helper\" \"$1\"; done; exit 127",
			"refarm-vscode-open-external",
			url,
		],
		`VS Code server openExternal ${url}`,
	);

	if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
		add("wslview", [url], `wslview ${url}`);
	}

	add("xdg-open", [url], `xdg-open ${url}`);
	add("sensible-browser", [url], `sensible-browser ${url}`);
	add("x-www-browser", [url], `x-www-browser ${url}`);
	add("www-browser", [url], `www-browser ${url}`);

	return candidates;
}

export function splitBrowserOpenCommand(commandLine: string): string[] {
	return splitCommandLine(commandLine, "REFARM_BROWSER_OPEN_COMMAND");
}

export async function openHostBrowserUrl(
	url: string,
	options: OpenHostBrowserUrlOptions = {},
): Promise<BrowserOpenResult> {
	const candidates = resolveBrowserOpenCandidates(url, options);
	const run = options.run ?? runBrowserOpenCandidate;
	const failures: string[] = [];

	for (const candidate of candidates) {
		try {
			await run(candidate);
			return { url, candidate };
		} catch (error) {
			failures.push(`${candidate.display}: ${formatBrowserOpenError(error)}`);
		}
	}

	throw new Error(
		[
			"Unable to open browser URL automatically.",
			`Tried: ${failures.join("; ") || "no opener candidates"}.`,
			`Open this URL manually: ${url}`,
		].join(" "),
	);
}

export function runBrowserOpenCandidate(
	spec: BrowserOpenSpec,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(spec.command, spec.args, {
			cwd: process.cwd(),
			stdio: "ignore",
			env: process.env,
		});

		child.once("error", (error) => {
			reject(error);
		});

		child.once("close", (code) => {
			if ((code ?? 0) === 0) {
				resolve();
				return;
			}

			reject(
				new Error(
					`Browser opener exited with code ${code ?? -1} (${spec.display}).`,
				),
			);
		});
	});
}

function formatBrowserOpenError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
