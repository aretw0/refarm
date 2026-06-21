#!/usr/bin/env node
import {
	parseTaskTransport,
	resolveChannelFromTransport,
	isChannelEffortPayload,
	normalizeChannelSource,
	normalizeChannelContext,
	encodeChannel,
	decodeChannel,
	buildChannelEffortsPath,
	buildChannelEffortPath,
	buildChannelEffort,
} from "./dist/index.js";

function safeError(fn) {
	try {
		return { ok: true, value: fn() };
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function normalizeEffort(effort) {
	if (!effort || typeof effort !== "object") {
		return effort;
	}
	const { id, submittedAt, ...rest } = effort;
	return {
		...rest,
		_hasId: Boolean(id),
		_hasSubmittedAt: typeof submittedAt === "string" && submittedAt.length > 0,
	};
}

const output = {
	parse: {
		file: parseTaskTransport("file"),
		http: parseTaskTransport("http"),
		channel: parseTaskTransport("channel:matrix"),
		invalid: safeError(() => parseTaskTransport("grpc")),
	},
	resolveChannelFromTransport: {
		file: resolveChannelFromTransport("file"),
		channel: resolveChannelFromTransport("channel:matrix"),
	},
	isChannelEffortPayload: {
		valid: isChannelEffortPayload({ direction: "prompt", tasks: [] }),
		emptyDirection: isChannelEffortPayload({ direction: "", tasks: [] }),
		nonArray: isChannelEffortPayload({ direction: "prompt", tasks: "x" }),
	},
	normalizedSource: {
		default: normalizeChannelSource("matrix", undefined),
		explicit: normalizeChannelSource("matrix", "explicit-source"),
	},
	normalizedContext: normalizeChannelContext(
		{ existing: true },
		"matrix",
		"thread-1",
		["t1", "t2"],
	),
	roundTripChannel: decodeChannel(encodeChannel("matrix:task/one")),
	buildPaths: {
		efforts: buildChannelEffortsPath("https://host/api", "matrix"),
		effort: buildChannelEffortPath(
			"https://host/api",
			"matrix",
			"eff-1",
			"status",
		),
	},
	effort: normalizeEffort(
		buildChannelEffort(
			{
				direction: "prompt",
				tasks: [],
				replyTo: "thread-1",
				traceIds: ["t1", "t2"],
				context: { existing: true },
				source: "matrix:explicit",
				priority: 3,
				tags: ["a", "b"],
			},
			"matrix",
		),
	),
};

console.log(JSON.stringify(output));
