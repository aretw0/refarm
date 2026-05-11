import { execFile } from "node:child_process";

export function tryOpenUrl(url: string): void {
	const [bin, ...args] =
		process.platform === "darwin"
			? ["open", url]
			: process.platform === "win32"
				? ["cmd", "/c", "start", "", url]
				: ["xdg-open", url];
	if (!bin) return;
	execFile(bin, args, () => {
		// best-effort — caller already printed the URL
	});
}
