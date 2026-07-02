import WebSocket from "ws";
import { BrowserSyncClient } from "../dist/browser-sync-client.js";

const runtimeUrl = process.env.REFARM_SYNC_RUNTIME_URL;

if (!runtimeUrl) {
	console.log(
		"skip: set REFARM_SYNC_RUNTIME_URL=ws://127.0.0.1:42000 to smoke a running Tractor daemon",
	);
	process.exit(0);
}

async function main() {
	const events = [];
	const appliedUpdates = [];
	const client = new BrowserSyncClient(
		createRuntimeSmokeStorage(appliedUpdates),
		{
			wsUrl: runtimeUrl,
			onEvent: (event) => events.push(event),
			webSocketConstructor: WebSocket,
		},
	);

	try {
		client.connect();
		const event = await waitForRuntimeSnapshot(events);
		if (event.byteLength <= 0) {
			throw new Error(`expected non-empty snapshot, got ${event.byteLength} bytes`);
		}
		if (appliedUpdates.length !== 1) {
			throw new Error(`expected one applied update, got ${appliedUpdates.length}`);
		}
		if (appliedUpdates[0]?.byteLength !== event.byteLength) {
			throw new Error(
				`applied byte length mismatch: ${appliedUpdates[0]?.byteLength} !== ${event.byteLength}`,
			);
		}
		console.log(
			`ok: BrowserSyncClient received ${event.byteLength} bytes from ${runtimeUrl}`,
		);
	} finally {
		client.disconnect();
	}
}

function createRuntimeSmokeStorage(appliedUpdates) {
	return {
		getUpdate: async () => new Uint8Array(),
		applyUpdate: async (bytes) => {
			appliedUpdates.push(bytes);
		},
		onUpdate: () => () => {},
	};
}

function waitForRuntimeSnapshot(observedEvents) {
	return new Promise((resolve, reject) => {
		const deadline = setTimeout(() => {
			clearInterval(interval);
			reject(
				new Error(
					`timed out waiting for BrowserSyncClient runtime snapshot; events: ${observedEvents
						.map((event) =>
							event.type === "error" ? `${event.type}:${event.error}` : event.type,
						)
						.join(", ")}`,
				),
			);
		}, 2_000);

		const interval = setInterval(() => {
			const failed = observedEvents.find(
				(candidate) => candidate.type === "remote-update-failed",
			);
			if (failed) {
				clearTimeout(deadline);
				clearInterval(interval);
				reject(new Error(`runtime snapshot apply failed: ${failed.error}`));
				return;
			}

			const applied = observedEvents.find(
				(candidate) => candidate.type === "remote-update-applied",
			);
			if (!applied) return;
			clearTimeout(deadline);
			clearInterval(interval);
			resolve(applied);
		}, 10);
	});
}

try {
	await main();
	process.exit(0);
} catch (error) {
	console.error(error);
	process.exit(1);
}
