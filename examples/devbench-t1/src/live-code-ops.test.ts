import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { createCodeOpsCapability, defaultCodeOpsArtifacts } from "./live-code-ops.js";

describe("code-ops verb — the editor plugin as a loaded extension (mount + guards)", () => {
	it("is mounted in the bench registry with an IDE command hint", () => {
		const verb = buildRegistry().get("code-ops");
		if (!verb || "actions" in verb) throw new Error("code-ops verb not mounted");
		expect(verb.summary).toContain("lsp-code-ops");
		expect(verb.renderers?.ide).toMatchObject({ command: "dgk.code-ops" });
	});

	it("rejects an unknown verb before touching the runtime", async () => {
		const verb = createCodeOpsCapability();
		const env = (await verb.run({ args: { verb: "delete-everything" }, options: {}, json: true })) as unknown as {
			ok: boolean;
			error: string;
		};
		expect(env.ok).toBe(false);
		expect(env.error).toBe("bad_verb");
	});

	it("points at the real, tested lsp-code-ops artifact", () => {
		const artifacts = defaultCodeOpsArtifacts();
		expect(artifacts.lspCodeOpsWasm).toContain("packages/lsp-code-ops/dist/plugin.wasm");
	});

	it("declares move-symbol as the third editor op (verb + target-file option)", () => {
		const verb = createCodeOpsCapability();
		if ("actions" in verb) throw new Error("expected a descriptor");
		// The third op is surfaced: the summary names it and the target-file option exists.
		expect(verb.summary).toContain("move-symbol");
		expect(verb.options?.some((o) => o.name === "target-file")).toBe(true);
	});
});
