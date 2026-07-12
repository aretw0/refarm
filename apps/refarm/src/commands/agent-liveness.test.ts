import { describe, expect, it } from "vitest";

import { classifyAgentLiveness } from "./agent-liveness.js";

describe("classifyAgentLiveness — the honest agent verdict", () => {
	it("a completed ok result → responsive", () => {
		const v = classifyAgentLiveness({ status: "ok", content: "ok" } as never, false, 1200);
		expect(v.status).toBe("responsive");
		expect(v.elapsedMs).toBe(1200);
	});

	it("a completed error result → responsive (the agent ran; the turn just failed)", () => {
		const v = classifyAgentLiveness({ status: "error", error: "model x" } as never, false, 900);
		expect(v.status).toBe("responsive");
		expect(v.message).toMatch(/errored/);
	});

	it("no result + timed out → UNRESPONSIVE (the zombie) with a restart hint", () => {
		const v = classifyAgentLiveness(null, true, 20000);
		expect(v.status).toBe("unresponsive");
		expect(v.message).toMatch(/UNRESPONSIVE/);
		// the zombie recovery is a clean restart — the fix we actually found
		expect(v.nextAction).toMatch(/runtime stop.*runtime start/);
	});

	it("no result + not timed out → runtime-unreachable", () => {
		const v = classifyAgentLiveness(null, false, 50);
		expect(v.status).toBe("runtime-unreachable");
	});
});
