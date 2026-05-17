/**
 * Farmhand test harness — starts a real farmhand subprocess for integration tests.
 *
 * Usage:
 *   import { startTestFarmhand } from "@refarm.dev/farmhand/test-harness";
 *   import { createModelMock, says } from "@refarm.dev/model-mock";
 *
 *   const mock = await createModelMock();
 *   mock.queue(says("Hello from the mock model!"));
 *
 *   const fh = await startTestFarmhand({ env: mock.env });
 *   const res = await fetch(fh.url("/efforts"), { method: "POST", ... });
 *   await fh.stop();
 *   await mock.stop();
 */

import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface TestFarmhand {
	/** HTTP port the sidecar is listening on. */
	port: number;
	/** Construct a full URL for a farmhand API path. */
	url(path: string): string;
	/** Terminate the farmhand subprocess and clean up the temp data dir. */
	stop(): Promise<void>;
}

export interface TestFarmhandOptions {
	/** Extra env vars to inject (e.g. ModelMockServer.env for model interception). */
	env?: Record<string, string>;
	/** Milliseconds to wait for farmhand to become ready. Default: 15000. */
	timeout?: number;
}

function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as net.AddressInfo;
			server.close(() => resolve(port));
		});
		server.on("error", reject);
	});
}

async function pollReady(url: string, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
			if (res.status < 500) return;
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`[farmhand-harness] Farmhand did not become ready within ${timeoutMs}ms`);
}

/**
 * Start a farmhand instance as a subprocess in an isolated temp directory.
 *
 * The subprocess uses the built dist/index.js so tests run against the same
 * artifact that CI validates. Call `pnpm turbo build --filter=@refarm.dev/farmhand`
 * before running integration tests.
 */
export async function startTestFarmhand(
	opts: TestFarmhandOptions = {},
): Promise<TestFarmhand> {
	const port = await findFreePort();
	const dataDir = await mkdtemp(join(tmpdir(), "farmhand-test-"));

	// Resolve dist/index.js relative to this file (both live in dist/ after build)
	const entry = fileURLToPath(new URL("./index.js", import.meta.url));

	const env: Record<string, string> = {
		...process.env as Record<string, string>,
		FARMHAND_HTTP_PORT: String(port),
		FARMHAND_DATA_DIR: dataDir,
		// Disable bundled plugin install in tests unless model env is provided
		FARMHAND_SKIP_BUNDLED_INSTALL: "1",
		...opts.env,
	};

	const child: ChildProcess = spawn(process.execPath, [entry], {
		env,
		stdio: "pipe",
	});

	child.stderr?.on("data", (chunk: Buffer) => {
		// Forward farmhand stderr so test failures include context
		process.stderr.write(`[farmhand-test] ${chunk.toString()}`);
	});

	const healthUrl = `http://127.0.0.1:${port}/efforts`;
	try {
		await pollReady(healthUrl, opts.timeout ?? 15_000);
	} catch (err) {
		child.kill("SIGTERM");
		await rm(dataDir, { recursive: true, force: true });
		throw err;
	}

	return {
		port,
		url: (path: string) => `http://127.0.0.1:${port}${path}`,
		async stop(): Promise<void> {
			child.kill("SIGTERM");
			await new Promise<void>((resolve) => child.on("close", resolve));
			await rm(dataDir, { recursive: true, force: true });
		},
	};
}
