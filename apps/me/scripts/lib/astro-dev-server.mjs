import { spawn } from "node:child_process";
import { once } from "node:events";

export function startAstroDevServer({ appRoot, port }) {
	const appUrl = `http://127.0.0.1:${port}/`;
	const output = [];
	const server = spawn(
		"pnpm",
		["exec", "astro", "dev", "--host", "127.0.0.1", "--port", String(port)],
		{
			cwd: appRoot,
			env: { ...process.env, NO_COLOR: "1" },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	server.stdout?.on("data", (chunk) => output.push(chunk.toString()));
	server.stderr?.on("data", (chunk) => output.push(chunk.toString()));

	return {
		appUrl,
		output,
		server,
		stop: () => stopServer(server),
		waitForHttp: (timeoutMs) => waitForHttp(appUrl, server, timeoutMs),
	};
}

async function waitForHttp(url, server, timeout) {
	const started = Date.now();
	while (Date.now() - started < timeout) {
		if (server.exitCode !== null) {
			throw new Error(`Astro dev server exited with code ${server.exitCode}`);
		}
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Retry until the server is ready or timeout is reached.
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error(`Timed out waiting for ${url}`);
}

async function stopServer(child) {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	const exit = once(child, "exit");
	const timeout = new Promise((resolve) => setTimeout(resolve, 2_000));
	await Promise.race([exit, timeout]);
	if (child.exitCode === null) child.kill("SIGKILL");
}
