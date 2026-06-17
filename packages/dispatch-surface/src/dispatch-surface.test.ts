import { describe, expect, it } from "vitest";
import {
	buildChannelEffort,
	isChannelEffortPayload,
	parseTaskTransport,
} from "./dispatch-surface.js";

describe("dispatch transport parser", () => {
	it("accepts static and channel transports", () => {
		expect(parseTaskTransport("file")).toBe("file");
		expect(parseTaskTransport("http")).toBe("http");
		expect(parseTaskTransport("channel:matrix")).toBe("channel:matrix");
		expect(() => parseTaskTransport("grpc")).toThrow(
			'Invalid task transport "grpc". Use: file, http, channel:<name>',
		);
	});
});

describe("channel effort payload validation", () => {
	it("accepts valid effort payloads", () => {
		expect(isChannelEffortPayload({ direction: "x", tasks: [] as const })).toBe(
			true,
		);
	});

	it("rejects invalid effort payloads", () => {
		expect(isChannelEffortPayload({ direction: "", tasks: [] })).toBe(false);
		expect(isChannelEffortPayload({ direction: "x", tasks: "not-array" })).toBe(
			false,
		);
		expect(isChannelEffortPayload(undefined)).toBe(false);
	});
});

describe("channel effort construction", () => {
	it("normalizes source and context metadata", () => {
		const payload = {
			direction: "prompt",
			tasks: [],
			replyTo: "thread-1",
			traceIds: ["t1", "t2"],
			context: {
				existing: true,
			},
		};
		const effort = buildChannelEffort(payload, "matrix");
		expect(effort.source).toBe("channel:matrix");
		expect(effort.context).toMatchObject({
			existing: true,
			channel: "matrix",
			replyTo: "thread-1",
			traceIds: ["t1", "t2"],
		});
	});
});
