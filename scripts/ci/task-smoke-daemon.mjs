import os from "node:os";
import path from "node:path";
import { FileTransportAdapter } from "../../apps/farmhand/dist/transports/file.js";
import { HttpSidecar } from "../../apps/farmhand/dist/transports/http.js";

function resolveBaseDir() {
	const explicit = process.env.REFARM_TASK_SMOKE_BASEDIR;
	if (explicit && explicit.trim()) return explicit;
	return path.join(os.homedir(), ".refarm");
}

async function main() {
	const baseDir = resolveBaseDir();
	const adapter = new FileTransportAdapter(baseDir, async (task) => {
		return {
			status: "error",
			error: `Smoke daemon intentionally fails task execution (${task.pluginId}.${task.fn})`,
		};
	});
	const stopWatch = adapter.watch();

	const sidecar = new HttpSidecar(42001, adapter);
	await sidecar.start();
	console.log(
		`[task-smoke-daemon] ready on http://127.0.0.1:42001 (baseDir=${baseDir})`,
	);

	const shutdown = async () => {
		stopWatch();
		await sidecar.stop();
		process.exit(0);
	};

	process.on("SIGTERM", () => {
		void shutdown();
	});
	process.on("SIGINT", () => {
		void shutdown();
	});
}

void main().catch((error) => {
	const message =
		error instanceof Error ? (error.stack ?? error.message) : String(error);
	console.error(`[task-smoke-daemon] failed: ${message}`);
	process.exit(1);
});
