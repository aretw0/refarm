import type { ProcessStatus } from "@refarm.dev/process-contract-v1";
import { describe, expect, it } from "vitest";

import { readRuntimeSupervision, SUPERVISED_RUNTIME_PROCESS } from "./runtime-supervision.js";

function status(partial: Partial<ProcessStatus> & { name: string }): ProcessStatus {
	return {
		state: "running",
		detail: "",
		backend: "systemd-user",
		supervised: true,
		...partial,
	} as ProcessStatus;
}

describe("readRuntimeSupervision", () => {
	it("reports supervised with the exact systemctl lines when the daemon is declared and up", async () => {
		const result = await readRuntimeSupervision({
			readStatuses: async () => [status({ name: SUPERVISED_RUNTIME_PROCESS })],
		});
		expect(result.supervised).toBe(true);
		expect(result.unit).toBe("refarm-runtime.service");
		expect(result.stopCommand).toBe("systemctl --user stop refarm-runtime.service");
		expect(result.restartCommand).toBe("systemctl --user restart refarm-runtime.service");
	});

	it("reports unsupervised when no runtime process is declared", async () => {
		const result = await readRuntimeSupervision({
			readStatuses: async () => [status({ name: "web-serve" })],
		});
		expect(result.supervised).toBe(false);
	});

	// Declared in config, no unit written yet: `process status` answers `not-declared` when the
	// name is unknown and `supervised: false` when nothing supervises it. Either way `stop` must
	// keep working the way it does today.
	it("reports unsupervised for a declared runtime with no unit installed", async () => {
		const result = await readRuntimeSupervision({
			readStatuses: async () => [
				status({
					name: SUPERVISED_RUNTIME_PROCESS,
					state: "not-running",
					backend: null,
					supervised: false,
				}),
			],
		});
		expect(result.supervised).toBe(false);
	});

	// THE SUBTLE ONE. `supervised: null` means "could not ask systemd". Reading an unknown as
	// supervised would refuse the only stop the operator has left, so this fails OPEN — the
	// opposite of the integrity default, because here a wrong refusal is worse than a wrong stop.
	it("treats could-not-ask as UNSUPERVISED, never as supervised", async () => {
		const result = await readRuntimeSupervision({
			readStatuses: async () => [
				status({ name: SUPERVISED_RUNTIME_PROCESS, state: "could-not-ask", supervised: null }),
			],
		});
		expect(result.supervised).toBe(false);
	});

	it("treats a reader that throws as UNSUPERVISED rather than propagating", async () => {
		const result = await readRuntimeSupervision({
			readStatuses: async () => {
				throw new Error("systemctl is not on this host");
			},
		});
		expect(result.supervised).toBe(false);
		expect(result.unit).toBe("refarm-runtime.service");
	});
	// FOUND BY RUNNING IT, 2026-08-27: the unit file was written and never started while a daemon
	// from an earlier `runtime restart` was still alive. `supervised: true, state: not-running`
	// made `runtime stop` refuse and hand over a systemctl line that stops nothing, because the
	// live process is not that unit's child. A unit file is not supervision of a running orphan.
	it("does not claim supervision when the unit exists but is not running the daemon", async () => {
		const result = await readRuntimeSupervision({
			readStatuses: async () => [
				status({
					name: SUPERVISED_RUNTIME_PROCESS,
					state: "not-running",
					detail: "refarm-runtime.service is inactive (dead)",
					supervised: true,
				}),
			],
		});
		expect(result.supervised).toBe(false);
	});

	it("does not claim supervision for a failed unit", async () => {
		const result = await readRuntimeSupervision({
			readStatuses: async () => [
				status({ name: SUPERVISED_RUNTIME_PROCESS, state: "failed", supervised: true }),
			],
		});
		expect(result.supervised).toBe(false);
	});
});
