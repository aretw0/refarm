import { describe, expect, it } from "vitest";
import {
	buildChannelEffort,
	getRegisteredChannelControlSurface,
	isChannelEffortPayload,
	parseTaskTransport,
	removeChannelControlSurfaceAdapter,
	resolveChannelControlSurfaceAdapter,
	setChannelControlSurfaceAdapter,
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

describe("channel control-surface adapters", () => {
	it("resolves known and fallback adapters", () => {
		const known = resolveChannelControlSurfaceAdapter("matrix");
		const unknown = resolveChannelControlSurfaceAdapter("future-irc");

		expect(known.channel).toBe("matrix");
		expect(
			known.adapter.buildSubmitPath("http://127.0.0.1:42001", "matrix"),
		).toBe("http://127.0.0.1:42001/channels/matrix/efforts");
		expect(
			known.adapter.buildSummaryPath("http://127.0.0.1:42001", "matrix"),
		).toBe("http://127.0.0.1:42001/efforts/summary");

		expect(unknown.channel).toBe("future-irc");
		expect(
			unknown.adapter.buildListPath("http://127.0.0.1:42001", "future-irc"),
		).toBe("http://127.0.0.1:42001/efforts");
	});

	it("supports registry override and restore via set/remove", () => {
		const original = getRegisteredChannelControlSurface("matrix");
		expect(original).toBeDefined();
		if (!original) return;

		const custom = {
			...original,
			adapter: {
				...original.adapter,
				capabilities: {
					...original.adapter.capabilities,
					retry: false,
				},
			},
		};

		const previous = setChannelControlSurfaceAdapter("matrix", custom.adapter);
		expect(previous?.channel).toBe("matrix");
		expect(
			resolveChannelControlSurfaceAdapter("matrix").adapter.capabilities.retry,
		).toBe(false);

		removeChannelControlSurfaceAdapter("matrix");
		expect(getRegisteredChannelControlSurface("matrix")).toBeUndefined();
		expect(resolveChannelControlSurfaceAdapter("matrix").channel).toBe("matrix");
		expect(
			resolveChannelControlSurfaceAdapter("matrix").adapter.capabilities.retry,
		).toBe(true);

		setChannelControlSurfaceAdapter("matrix", original.adapter);
		expect(
			getRegisteredChannelControlSurface("matrix")?.adapter,
		).toBe(original.adapter);
	});
});
