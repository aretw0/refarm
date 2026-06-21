import { describe, expect, it, vi } from "vitest";
import { createAgentCommand } from "../../src/commands/agent.js";

type FinishTemplate = {
	command: string;
	cwdParameter?: string;
	effects?: string[];
	id: string;
	parameters: string[];
	process?: {
		args: string[];
		command: string;
		display: string;
	};
	useWhen: string;
	writes?: boolean;
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
		expect(templates).toContainEqual(
			expect.objectContaining({
				id: "declared-workspaces-execution-all-json",
				command: "refarm workspace execution --all --json",
				effects: ["observe"],
				writes: false,
				parameters: [],
			}),
		);
		expect(templates).toContainEqual(
			expect.objectContaining({
				id: "declared-release-kernel-candidates-json",
				command: "refarm release plan --selection default --json",
				effects: ["observe"],
				writes: false,
				parameters: [],
			}),
		);
		const externalTemplates = templates.filter((template) =>
			template.id.startsWith("external-consumer-")
		);

		expect(externalTemplates.map((template) => template.id)).toEqual([
			"external-consumer-resume-json",
			"external-consumer-check-json",
			"external-consumer-workspace-execution-json",
			"external-consumer-release-plan-json",
			"external-consumer-health-policy-json",
			"external-consumer-health-suggest-policy-json",
		]);

		for (const template of externalTemplates) {
			expect(template.parameters).toEqual(["dir"]);
			if (
				template.id === "external-consumer-workspace-execution-json" ||
				template.id === "external-consumer-release-plan-json"
			) {
				expect(template.cwdParameter).toBeUndefined();
			} else {
				expect(template.cwdParameter).toBe("dir");
			}
			expect(template.command).toMatch(/^refarm (?:resume|check|workspace|release|health)\b/);
			expect(template.command).toMatch(/\s--json$/);
			expect(template.effects).toEqual(["observe"]);
			expect(template.writes).toBe(false);
			expect(template.process?.command).toMatch(/(?:^|[/\\])refarm(?:\.cmd)?$/);
			expect(template.process?.display).toContain(template.process?.args.join(" "));
			expect(template.process?.args.at(-1)).toBe("--json");
			expect([template.command, template.process?.args.join(" ") ?? ""].join("\n")).not.toMatch(
				/\b(?:--apply-suggested-policy|--fix|--run|apply|deploy|install|migrate|provision|publish|write|writing)\b/i,
			);
			if (template.id === "external-consumer-health-policy-json") {
				expect(template.useWhen).toMatch(/without running auditors or writing config/);
			}
			if (template.id === "external-consumer-workspace-execution-json") {
				expect(template.useWhen).toMatch(/executor and cache readiness/);
				expect(template.command).toBe("refarm workspace execution --cwd <dir> --json");
				expect(template.process?.args).toEqual([
					"workspace",
					"execution",
					"--cwd",
					"<dir>",
					"--json",
				]);
			}
			if (template.id === "external-consumer-release-plan-json") {
				expect(template.useWhen).toMatch(/default release-policy selection/);
				expect(template.command).toBe(
					"refarm release plan --cwd <dir> --selection default --json",
				);
				expect(template.process?.args).toEqual([
					"release",
					"plan",
					"--cwd",
					"<dir>",
					"--selection",
					"default",
					"--json",
				]);
			}
			if (template.id === "external-consumer-health-suggest-policy-json") {
				expect(template.useWhen).toMatch(/without writing \.refarm\/config\.json/);
			}
		}
	});
});
