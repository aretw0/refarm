import { describe, expect, it } from "vitest";
import {
	assessInteractionDriverReadiness,
	createInteractionDriverDescriptor,
	INTERACTION_DRIVER_GATEWAY_BLOCKERS,
	INTERACTION_DRIVER_TERMINAL_EVENTS,
	validateInteractionDriverDescriptor,
} from "./interaction-driver.js";

describe("interaction driver contract", () => {
	it("creates a local-loop descriptor with bounded handoff defaults", () => {
		const descriptor = createInteractionDriverDescriptor({
			id: "runtime-agent.ask",
			title: "Runtime agent ask loop",
			description: "Submit a prompt, stream output, and preserve handoffs.",
		});

		expect(descriptor).toEqual({
			schemaVersion: 1,
			id: "runtime-agent.ask",
			title: "Runtime agent ask loop",
			description: "Submit a prompt, stream output, and preserve handoffs.",
			mode: "local-loop",
			eventContract: {
				format: "json-events",
				requiredEvents: ["accepted", "streamed", "completed", "failed"],
			},
			handoffs: {
				resume: true,
				session: true,
				task: true,
			},
			budget: {
				modelRoute: true,
				tokenUse: false,
				retries: false,
				stopCondition: false,
			},
		});
		expect(validateInteractionDriverDescriptor(descriptor)).toEqual({
			ok: true,
			issues: [],
		});
		expect(INTERACTION_DRIVER_TERMINAL_EVENTS).toEqual([
			"completed",
			"failed",
		]);
		expect(assessInteractionDriverReadiness(descriptor)).toEqual({
			ok: true,
			state: "ready",
			requestedMode: "local-loop",
			supportedMode: "local-loop",
			issues: [],
			blockers: [],
		});
	});

	it("blocks gateway-rpc promotion until lifecycle, steering, parity, and budget proofs exist", () => {
		const descriptor = createInteractionDriverDescriptor({
			id: "runtime-agent.ask",
			title: "Runtime agent ask loop",
			description: "Promote the local ask loop to a gateway contract.",
			mode: "gateway-rpc",
			budget: {
				tokenUse: true,
				retries: true,
				stopCondition: true,
			},
		});

		expect(assessInteractionDriverReadiness(descriptor)).toEqual({
			ok: false,
			state: "blocked",
			requestedMode: "gateway-rpc",
			supportedMode: "local-loop",
			issues: [],
			blockers: INTERACTION_DRIVER_GATEWAY_BLOCKERS,
		});
	});

	it("rejects descriptors that hide lifecycle or handoff requirements", () => {
		const descriptor = createInteractionDriverDescriptor({
			id: "",
			title: " ",
			description: "Invalid descriptor.",
			requiredEvents: ["accepted"],
			handoffs: {
				session: false,
			},
			budget: {
				modelRoute: false,
			},
		});

		expect(validateInteractionDriverDescriptor(descriptor)).toEqual({
			ok: false,
			issues: [
				"id is required",
				"title is required",
				"eventContract.requiredEvents must include streamed",
				"eventContract.requiredEvents must include completed",
				"eventContract.requiredEvents must include failed",
				"handoffs.session must be true",
				"budget.modelRoute must be true",
			],
		});
		expect(assessInteractionDriverReadiness(descriptor).blockers).toEqual([
			{
				code: "descriptor.validation-failed",
				requirement: "lifecycle",
				description:
					"Interaction driver descriptor must pass validation before it can be exposed as a reference-driver contract.",
				proofTarget:
					"descriptor contract: valid interaction id, JSON event contract, resume/session/task handoffs, and model route visibility",
			},
		]);
	});
});
