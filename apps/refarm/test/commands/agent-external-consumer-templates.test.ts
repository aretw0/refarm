import { describe, expect, it, vi } from "vitest";
import { createAgentCommand } from "../../src/commands/agent.js";

type FinishTemplate = {
	command: string;
	cwdParameter?: string;
	id: string;
	parameters: string[];
	process?: {
		args: string[];
		command: string;
		display: string;
	};
	useWhen: string;
};

async function finishTemplates(): Promise<FinishTemplate[]> {
	const agentCommand = createAgentCommand();
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	try {
		await agentCommand.parseAsync(["finish", "--templates", "--json"], {
			from: "user",
		});
		const payload = JSON.parse(String(logSpy.mock.calls[0]?.[0])) as {
			templates: FinishTemplate[];
		};
		return payload.templates;
	} finally {
		logSpy.mockRestore();
	}
}

describe("agent external consumer templates", () => {
	it("keeps external consumer templates as read-only JSON probes", async () => {
		const templates = await finishTemplates();
		const externalTemplates = templates.filter((template) =>
			template.id.startsWith("external-consumer-")
		);

		expect(externalTemplates.map((template) => template.id)).toEqual([
			"external-consumer-resume-json",
			"external-consumer-check-json",
			"external-consumer-health-policy-json",
			"external-consumer-health-suggest-policy-json",
		]);

		for (const template of externalTemplates) {
			expect(template.parameters).toEqual(["dir"]);
			expect(template.cwdParameter).toBe("dir");
			expect(template.command).toMatch(/^refarm (?:resume|check|health)\b/);
			expect(template.command).toMatch(/\s--json$/);
			expect(template.process?.command).toBe("refarm");
			expect(template.process?.display).toBe(template.command);
			expect(template.process?.args.at(-1)).toBe("--json");
			expect([template.command, template.process?.args.join(" ") ?? ""].join("\n")).not.toMatch(
				/\b(?:--apply-suggested-policy|--fix|--run|apply|deploy|install|migrate|provision|publish|write|writing)\b/i,
			);
			if (template.id === "external-consumer-health-policy-json") {
				expect(template.useWhen).toMatch(/without running auditors or writing config/);
			}
			if (template.id === "external-consumer-health-suggest-policy-json") {
				expect(template.useWhen).toMatch(/without writing \.refarm\/config\.json/);
			}
		}
	});
});
