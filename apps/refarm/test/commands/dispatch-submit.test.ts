import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { SidecarHttpError } from "@refarm.dev/sidecar-client";
import { afterEach, describe, expect, it } from "vitest";

import {
	buildDispatchEffort,
	submitEffortViaSidecar,
} from "../../src/commands/dispatch-submit.js";

let restoreSidecarUrl: string | undefined;

afterEach(() => {
	if (restoreSidecarUrl === undefined) {
		delete process.env.REFARM_SIDECAR_URL;
	} else {
		process.env.REFARM_SIDECAR_URL = restoreSidecarUrl;
	}
	restoreSidecarUrl = undefined;
});

function effort() {
	return buildDispatchEffort(
		{ pluginId: "plugin.example", verb: "review", args: { id: "item-1" } },
		(() => {
			let i = 0;
			return () => `id-${++i}`;
		})(),
		() => "2026-07-08T00:00:00.000Z",
	);
}

async function withSidecarServer(
	handler: (req: IncomingMessage, res: ServerResponse) => void,
	run: () => Promise<void>,
): Promise<void> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	restoreSidecarUrl = process.env.REFARM_SIDECAR_URL;
	process.env.REFARM_SIDECAR_URL = `http://127.0.0.1:${port}`;
	try {
		await run();
	} finally {
		await new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});
	}
}

describe("submitEffortViaSidecar", () => {
	it("posts dispatch efforts to the runtime sidecar", async () => {
		let receivedPath = "";
		let receivedMethod = "";
		let receivedBody = "";
		await withSidecarServer(
			(req, res) => {
				receivedPath = req.url ?? "";
				receivedMethod = req.method ?? "";
				req.setEncoding("utf8");
				req.on("data", (chunk) => {
					receivedBody += chunk;
				});
				req.on("end", () => {
					res.writeHead(200, { "content-type": "application/json" });
					res.end(JSON.stringify({ effortId: "effort-123" }));
				});
			},
			async () => {
				await expect(submitEffortViaSidecar(effort())).resolves.toBe(
					"effort-123",
				);
			},
		);

		expect(receivedPath).toBe("/efforts");
		expect(receivedMethod).toBe("POST");
		expect(JSON.parse(receivedBody)).toMatchObject({
			direction: "dispatch",
			tasks: [{ pluginId: "plugin.example", fn: "review" }],
		});
	});

	it("surfaces sidecar HTTP failures as typed sidecar errors", async () => {
		await withSidecarServer(
			(_req, res) => {
				res.writeHead(503, { "content-type": "application/json" });
				res.end(JSON.stringify({ error: "unavailable" }));
			},
			async () => {
				await expect(submitEffortViaSidecar(effort())).rejects.toMatchObject({
					constructor: SidecarHttpError,
					errorLabel: "runtime HTTP",
					status: 503,
				});
			},
		);
	});
});
