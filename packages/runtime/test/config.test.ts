import { describe, expect, it } from "vitest";

import {
	resolveRuntimeConfigValueAsync,
	resolveRuntimeConfigValueSync,
	type RuntimeConfigValueSpec,
} from "../src/config.js";
import { parseRuntimeAutostartMode } from "../src/index.js";

const autostartSpec: RuntimeConfigValueSpec<"always" | "ask" | "never"> = {
	envProbes: [
		{ name: "DGK_RUNTIME_AUTOSTART", parse: parseRuntimeAutostartMode },
		{ name: "DGK_RUNTIME_AUTOSTART_FALLBACK", parse: parseRuntimeAutostartMode },
	],
	extract: (cfg) => cfg?.autostart,
	parse: parseRuntimeAutostartMode,
	default: "ask",
};

describe("runtime config value resolution", () => {
	it("resolves a scalar from host-provided env probes before config layers", () => {
		const result = resolveRuntimeConfigValueSync(autostartSpec, {
			env: {
				DGK_RUNTIME_AUTOSTART: "always",
				DGK_RUNTIME_AUTOSTART_FALLBACK: "never",
			},
			configs: [{ autostart: "never" }],
		});

		expect(result).toEqual({
			value: "always",
			source: "env:DGK_RUNTIME_AUTOSTART",
		});
	});

	it("uses last valid sync config layer so callers can model home then cwd", () => {
		const result = resolveRuntimeConfigValueSync(autostartSpec, {
			env: {},
			configs: [{ autostart: "never" }, { autostart: "always" }],
			configSources: ["home", "cwd"],
		});

		expect(result).toEqual({ value: "always", source: "cwd" });
	});

	it("lets async host config win before fallback config layers", async () => {
		const result = await resolveRuntimeConfigValueAsync(autostartSpec, {
			env: {},
			resolveConfig: async () => ({ autostart: "always" }),
			fallbackConfigs: [{ value: { autostart: "never" }, source: "home" }],
		});

		expect(result).toEqual({ value: "always", source: "host-config" });
	});

	it("uses the default when no env or config layer yields a valid value", async () => {
		const result = await resolveRuntimeConfigValueAsync(autostartSpec, {
			env: {},
			resolveConfig: async () => ({ autostart: "invalid" }),
			fallbackConfigs: [{ value: { autostart: "" }, source: "home" }],
		});

		expect(result).toEqual({ value: "ask", source: "default" });
	});
});
