import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	resolveRefarmDirectories,
	resolveRefarmHome,
	resolveRefarmScopeRoot,
} from "./refarm-home.js";

describe("Refarm directory policy", () => {
	it("keeps REFARM_HOME as the explicit compatibility root", () => {
		const env = { REFARM_HOME: "/var/lib/refarm-personal" };
		expect(resolveRefarmHome(env)).toBe("/var/lib/refarm-personal");
		expect(resolveRefarmDirectories(env)).toMatchObject({
			root: "/var/lib/refarm-personal",
			distribution: "/var/lib/refarm-personal/dist",
			plugins: "/var/lib/refarm-personal/plugins",
		});
	});

	it("makes a relative REFARM_HOME absolute at the app boundary", () => {
		expect(resolveRefarmDirectories({ REFARM_HOME: ".refarm" }).root).toBe(
			path.resolve(".refarm"),
		);
	});

	it("resolves explicit, workspace, then operator scope in that order", () => {
		expect(resolveRefarmScopeRoot({ REFARM_HOME: "/explicit" }, "/work", () => true)).toBe(
			"/explicit",
		);
		expect(resolveRefarmScopeRoot({}, "/work", (candidate) => candidate === "/work/.refarm")).toBe(
			"/work/.refarm",
		);
		expect(resolveRefarmScopeRoot({}, "/work", () => false)).toBe(resolveRefarmHome({}));
	});
});
