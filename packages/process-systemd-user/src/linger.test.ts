import {
	applyChanges,
	createMemoryOperationTrail,
	renderOperationRequest,
	reverseChanges,
	runOperationConsent,
	type OperationConsentChannel,
} from "@refarm.dev/operation-consent-v1";
import { SupervisionRefusal } from "@refarm.dev/process-contract-v1";
import { describe, expect, it } from "vitest";

import {
	buildLingerRequest,
	createLingerFileSystem,
	describeUnitLifetime,
	LINGER_OPERATION_KIND,
	lingerMarkerPath,
	PROCESS_UNIT_OPERATION_KIND,
	readLingerState,
	refuseBundledLinger,
} from "./linger.js";
import type { CommandResult, CommandRunner } from "./runner.js";

const USER = "op";

function scripted(script: Record<string, CommandResult>): CommandRunner & { calls: string[] } {
	const calls: string[] = [];
	return {
		calls,
		async run(command, args) {
			const key = [command, ...args].join(" ");
			calls.push(key);
			return script[key] ?? { spawned: true, code: 1, stdout: "", stderr: `unscripted: ${key}` };
		},
	};
}

function answering(answer: string): OperationConsentChannel {
	return {
		async ask() {
			return answer;
		},
	};
}

const request = (current: "enabled" | "disabled" | "unknown" = "disabled") =>
	buildLingerRequest({
		user: USER,
		requester: "refarm process linger",
		requestedAt: "2026-07-31T12:00:00.000Z",
		current,
	});

describe("reading the lingering state, with 'could not ask' kept apart from 'no'", () => {
	it("reads yes and no", async () => {
		expect(
			(
				await readLingerState(
					scripted({
						"loginctl show-user op --property=Linger": {
							spawned: true,
							code: 0,
							stdout: "Linger=yes\n",
							stderr: "",
						},
					}),
					USER,
				)
			).state,
		).toBe("enabled");
		expect(
			(
				await readLingerState(
					scripted({
						"loginctl show-user op --property=Linger": {
							spawned: true,
							code: 0,
							stdout: "Linger=no\n",
							stderr: "",
						},
					}),
					USER,
				)
			).state,
		).toBe("disabled");
	});

	it("a loginctl that cannot be run is UNKNOWN, never 'disabled'", async () => {
		const result = await readLingerState(
			{
				async run() {
					return { spawned: false, code: null, stdout: "", stderr: "loginctl: not found" };
				},
			},
			USER,
		);
		expect(result.state).toBe("unknown");
		expect(result.detail).toMatch(/cannot say whether "op" lingers/);
	});

	it("output without a Linger property is UNKNOWN", async () => {
		const result = await readLingerState(scripted({}), USER);
		expect(result.state).toBe("unknown");
	});
});

describe("W3 — the lifetime sentence is the measured one", () => {
	it("off: names the logout, and names the separate operation", () => {
		const line = describeUnitLifetime("disabled", USER);
		expect(line).toMatch(/STOPS WHEN YOU LOG OUT/);
		expect(line).toMatch(/does not come back at boot until you log in/);
		expect(line).toContain("refarm process linger");
	});

	it("on: claims survival, and only then", () => {
		expect(describeUnitLifetime("enabled", USER)).toMatch(/KEEPS RUNNING after you log out/);
	});

	it("unknown: says it does not know, and how to find out", () => {
		const line = describeUnitLifetime("unknown", USER);
		expect(line).toMatch(/does NOT know/);
		expect(line).toContain("loginctl show-user op --property=Linger");
	});
});

describe("lingering is its own operation, decided on its own", () => {
	it("has its own id and kind, distinct from a unit installation", () => {
		expect(request().id).toBe(`${LINGER_OPERATION_KIND}:${USER}`);
		expect(request().kind).toBe(LINGER_OPERATION_KIND);
		expect(request().kind).not.toBe(PROCESS_UNIT_OPERATION_KIND);
	});

	it("changes ONLY the lingering state", () => {
		expect(request().changes.map((change) => change.path)).toEqual([lingerMarkerPath(USER)]);
	});

	it("states what it costs, not only what it gives", () => {
		const rendered = renderOperationRequest(request()).join("\n");
		expect(rendered).toMatch(/O QUE CUSTA/);
		expect(rendered).toMatch(/decisão sobre a MÁQUINA/);
		expect(rendered).toMatch(/operação SEPARADA/);
		expect(rendered).toContain(`loginctl disable-linger ${USER}`);
	});

	it("refuses a linger request that smuggles anything else in", () => {
		expect(() =>
			refuseBundledLinger({
				...request(),
				changes: [
					...request().changes,
					{
						path: "/home/op/.config/systemd/user/refarm-web-serve.service",
						before: null,
						after: "x",
					},
				],
			}),
		).toThrow(/may change nothing but the lingering state/);
	});

	it("refuses ANY non-linger operation that would also enable lingering", () => {
		const error = (() => {
			try {
				refuseBundledLinger({
					id: "process-unit:systemd-user:web-serve",
					kind: PROCESS_UNIT_OPERATION_KIND,
					title: "install",
					purpose: "supervise",
					requester: "test",
					requestedAt: "2026-07-31T12:00:00.000Z",
					changes: [
						{ path: "/tmp/x/refarm-web-serve.service", before: null, after: "unit" },
						{ path: lingerMarkerPath(USER), before: null, after: "" },
					],
					undo: { kind: "restore-snapshot", summary: "…" },
				});
				return null;
			} catch (thrown) {
				return thrown as SupervisionRefusal;
			}
		})();
		expect(error).toBeInstanceOf(SupervisionRefusal);
		expect(error?.reason).toBe("bundled-consent");
		expect(error?.fix).toMatch(/refarm process linger/);
	});
});

describe("the linger filesystem turns the snapshot into the loginctl the machine understands", () => {
	it("applying the change runs enable-linger; the reverse runs disable-linger", async () => {
		const runner = scripted({
			"loginctl enable-linger op": { spawned: true, code: 0, stdout: "", stderr: "" },
			"loginctl disable-linger op": { spawned: true, code: 0, stdout: "", stderr: "" },
		});
		const fs = createLingerFileSystem(runner, USER);
		await applyChanges([...request().changes], fs);
		expect(runner.calls).toContain("loginctl enable-linger op");

		await applyChanges(reverseChanges([...request().changes]), fs);
		expect(runner.calls).toContain("loginctl disable-linger op");
	});

	it("refuses to touch any path but the lingering marker", async () => {
		const fs = createLingerFileSystem(scripted({}), USER);
		await expect(fs.writeFile("/etc/passwd", "")).rejects.toBeInstanceOf(SupervisionRefusal);
	});

	it("a loginctl that fails raises a refusal naming what the operator would run", async () => {
		const fs = createLingerFileSystem(
			scripted({
				"loginctl enable-linger op": {
					spawned: true,
					code: 1,
					stdout: "",
					stderr: "Interactive authentication required.",
				},
			}),
			USER,
		);
		const error = await fs
			.writeFile(lingerMarkerPath(USER), "")
			.catch((thrown: unknown) => thrown as SupervisionRefusal);
		expect(error).toBeInstanceOf(SupervisionRefusal);
		expect(error.fix).toContain(`loginctl enable-linger ${USER}`);
	});

	it("the consent journey applies it only when the operator authorises", async () => {
		const runner = scripted({
			"loginctl enable-linger op": { spawned: true, code: 0, stdout: "", stderr: "" },
		});
		const declined = await runOperationConsent({
			request: request(),
			trail: createMemoryOperationTrail(),
			channel: answering("decline"),
			fs: createLingerFileSystem(runner, USER),
			now: () => "2026-07-31T12:00:01.000Z",
		});
		expect(declined.status).toBe("declined");
		expect(runner.calls).not.toContain("loginctl enable-linger op");

		const authorized = await runOperationConsent({
			request: request(),
			trail: createMemoryOperationTrail(),
			channel: answering("authorize"),
			fs: createLingerFileSystem(runner, USER),
			now: () => "2026-07-31T12:00:02.000Z",
		});
		expect(authorized.status).toBe("authorized");
		expect(runner.calls).toContain("loginctl enable-linger op");
	});
});
