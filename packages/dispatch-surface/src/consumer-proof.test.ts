import { afterEach, describe, expect, it } from "vitest";

import {
	assertChannelControlCapability,
	buildChannelEffortPath,
	buildChannelEffortsPath,
	CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
	type ChannelControlSurfaceAdapter,
	hasChannelControlCapability,
	isKnownChannelControlSurface,
	listKnownChannelControlSurfaces,
	parseTaskTransport,
	resolveChannelControlSurfaceAdapter,
	resolveChannelFromTransport,
	setChannelControlSurfaceAdapter,
} from "./index.js";

const BASE_URL = "http://127.0.0.1:42001/";
const KNOWN_CHANNEL = "matrix";

let adapterToRestore: ChannelControlSurfaceAdapter | undefined;

afterEach(() => {
	if (adapterToRestore) {
		setChannelControlSurfaceAdapter(KNOWN_CHANNEL, adapterToRestore);
		adapterToRestore = undefined;
	}
});

describe("dispatch-surface external consumer proof", () => {
	it("resolves a known channel from a channel:<name> transport", () => {
		expect(listKnownChannelControlSurfaces()).toContain(KNOWN_CHANNEL);

		const transport = parseTaskTransport(`channel:${KNOWN_CHANNEL}`);

		expect(resolveChannelFromTransport(transport)).toBe(KNOWN_CHANNEL);
	});

	it("normalizes an unknown channel to the fallback control surface", () => {
		const resolved = resolveChannelControlSurfaceAdapter(
			" definitely-not-a-channel ",
		);

		expect(resolved.channel).toBe("definitely-not-a-channel");
		expect(isKnownChannelControlSurface(resolved.channel)).toBe(false);
		expect(resolved.adapter.id).toBe("http-channel-control");
		expect(resolved.adapter.capabilities).toMatchObject({
			list: true,
			logs: true,
			query: true,
			submit: true,
		});
	});

	it("builds submit, status, and log paths for a known channel", () => {
		const adapter = resolveChannelControlSurfaceAdapter(KNOWN_CHANNEL).adapter;

		expect(buildChannelEffortsPath(BASE_URL, KNOWN_CHANNEL)).toBe(
			"http://127.0.0.1:42001/channels/matrix/efforts",
		);
		expect(buildChannelEffortPath(BASE_URL, KNOWN_CHANNEL, "effort-1")).toBe(
			"http://127.0.0.1:42001/channels/matrix/efforts/effort-1",
		);
		expect(adapter.buildSubmitPath(BASE_URL, KNOWN_CHANNEL)).toBe(
			"http://127.0.0.1:42001/channels/matrix/efforts",
		);
		expect(adapter.buildQueryPath(BASE_URL, KNOWN_CHANNEL, "effort-1")).toBe(
			"http://127.0.0.1:42001/channels/matrix/efforts/effort-1/status",
		);
		expect(adapter.buildLogsPath(BASE_URL, KNOWN_CHANNEL, "effort-1")).toBe(
			"http://127.0.0.1:42001/channels/matrix/efforts/effort-1/logs",
		);
	});

	it("surfaces an unsupported error when a capability is disabled via override", () => {
		const original = resolveChannelControlSurfaceAdapter(KNOWN_CHANNEL).adapter;
		adapterToRestore = original;
		const overridden: ChannelControlSurfaceAdapter = {
			...original,
			capabilities: {
				...original.capabilities,
				submit: false,
			},
		};

		setChannelControlSurfaceAdapter(KNOWN_CHANNEL, overridden);
		const adapter = resolveChannelControlSurfaceAdapter(KNOWN_CHANNEL).adapter;

		expect(hasChannelControlCapability(adapter, "submit")).toBe(false);
		expect(() => assertChannelControlCapability(adapter, "submit")).toThrow(
			CHANNEL_CONTROL_SURFACE_OPERATION_UNSUPPORTED_ERROR,
		);
	});
});
