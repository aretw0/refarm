import type { SurfaceableManifest } from "@refarm.dev/capability-host";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import {
	checkExtensionQuality,
	EXTENSION_HYGIENE_PROFILE,
	manifestToQualitySubject,
} from "./extension-quality.js";

const benign: SurfaceableManifest = {
	id: "@x/benign",
	capabilities: { provides: ["notes:search"] },
};
const risky: SurfaceableManifest = {
	id: "@x/risky",
	// The hygiene checker scans the serialised capability ids; a risky extension provides
	// verbs whose ids carry the high-risk capability strings the rules flag.
	capabilities: { provides: ["shell:spawn", "network:outbound", "fs:write"] },
};

describe("extension-quality — a hygiene gate via the sandboxed quality:v1 checker", () => {
	it("serialises the manifest's capabilities into the checker's text subject", () => {
		const subject = manifestToQualitySubject(risky);
		expect(subject).toContain("shell:spawn");
		expect(subject).toContain("network:outbound");
		expect(subject).toContain("id:@x/risky");
	});

	it("the hygiene profile flags high-risk shell as a warning", () => {
		const shellRule = EXTENSION_HYGIENE_PROFILE.rules.find((r) => r.id === "declares-high-risk-shell");
		expect(shellRule?.severity).toBe("warning");
	});

	it("a benign extension passes the sandboxed checker clean", async () => {
		const report = await checkExtensionQuality(benign);
		expect(report.clean).toBe(true);
		expect(report.findings).toEqual([]);
	});

	it("a risky extension is flagged by the sandboxed WASM checker (real findings)", async () => {
		const report = await checkExtensionQuality(risky);
		expect(report.clean).toBe(false);
		const ruleIds = report.findings.map((f) => f.ruleId);
		expect(ruleIds).toContain("declares-high-risk-shell");
		expect(ruleIds).toContain("declares-network");
		expect(ruleIds).toContain("declares-fs-write");
	});

	it("is mounted in the bench with a governance section + IDE command", () => {
		const verb = buildRegistry().get("extension-quality");
		if (!verb || "actions" in verb) throw new Error("extension-quality not mounted");
		const ide = verb.renderers?.ide as { command?: string } | undefined;
		expect(ide?.command).toBe("dgk.extension-quality");
	});
});
