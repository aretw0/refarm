import { spawn } from "node:child_process";

export function runSubprocess(command, commandArgs, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, commandArgs, {
			cwd: options.cwd,
			env: options.env,
			stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
		});

		let stdout = "";
		let stderr = "";
		if (options.captureOutput) {
			child.stdout.on("data", (chunk) => {
				stdout += chunk.toString();
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});
		}

		child.on("error", reject);
		child.on("exit", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}

			const details = options.captureOutput
				? `${stderr || stdout || "unknown error"}`
				: `${command} exited with code ${code}`;
			reject(new Error(details.trim()));
		});
	});
}
