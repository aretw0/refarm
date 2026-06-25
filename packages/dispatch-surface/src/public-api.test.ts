import { describe, expect, it } from "vitest";

import * as ds from "./index.js";

// Types are erased at runtime and guarded by type-check; this list locks the
// curated runtime function surface exposed from the package root.
const LOCKED_RUNTIME_EXPORTS = [
	"assertChannelControlCapability",
	"buildChannelEffort",
	"buildChannelEffortPath",
	"buildChannelEffortsPath",
	"decodeChannel",
	"encodeChannel",
	"getRegisteredChannelControlSurface",
	"hasChannelControlCapability",
	"isChannelEffortPayload",
	"isKnownChannelControlSurface",
	"listKnownChannelControlSurfaces",
	"normalizeChannelContext",
	"normalizeChannelSource",
	"parseTaskTransport",
	"removeChannelControlSurfaceAdapter",
	"resolveChannelControlSurfaceAdapter",
	"resolveChannelFromTransport",
	"setChannelControlSurfaceAdapter",
].sort();

describe("dispatch-surface public API", () => {
	it("exposes exactly the locked runtime function surface from the package root", () => {
		const actual = Object.keys(ds)
			.filter((key) => typeof (ds as Record<string, unknown>)[key] === "function")
			.sort();

		expect(actual).toEqual(LOCKED_RUNTIME_EXPORTS);
	});
});
