import { describe, expect, it } from "vitest";
import { deriveWorkspaceCommandDeclaration } from "./workspace-command-declaration.js";

describe("deriveWorkspaceCommandDeclaration", () => {
	it("preserves exact argv without creating a shell command", () => {
		expect(
			deriveWorkspaceCommandDeclaration({
				name: "test-unit",
				argv: ["pnpm", "test", "value with spaces", "$(never-a-shell)"],
				cwd: "packages/api",
				description: "Run unit tests",
			}),
		).toEqual({
			name: "test-unit",
			entry: {
				run: ["pnpm", "test", "value with spaces", "$(never-a-shell)"],
				cwd: "packages/api",
				description: "Run unit tests",
			},
		});
	});

	it("rejects cwd outside the workspace", () => {
		expect(() =>
			deriveWorkspaceCommandDeclaration({ name: "test", argv: ["pnpm", "test"], cwd: "../other" }),
		).toThrow(/stay inside/);
	});

	it("rejects blank argv tokens and unstable names", () => {
		expect(() => deriveWorkspaceCommandDeclaration({ name: "bad name", argv: ["pnpm"] })).toThrow(
			/only letters/,
		);
		expect(() => deriveWorkspaceCommandDeclaration({ name: "test", argv: [""] })).toThrow(
			/at least one/,
		);
	});

	it("keeps operations local unless remote admission is explicit", () => {
		expect(deriveWorkspaceCommandDeclaration({ name: "status", argv: ["tool", "status"] }).entry).toEqual({
			run: ["tool", "status"],
		});
		expect(
			deriveWorkspaceCommandDeclaration({ name: "status", argv: ["tool", "status"], remote: true })
				.entry,
		).toEqual({ run: ["tool", "status"], remote: true });
	});

	it("declares only the closed operation result contract", () => {
		expect(
			deriveWorkspaceCommandDeclaration({
				name: "check",
				argv: ["tool", "check"],
				result: "operation-result.v1",
			}).entry,
		).toEqual({ run: ["tool", "check"], result: "operation-result.v1" });
		expect(() =>
			deriveWorkspaceCommandDeclaration({ name: "check", argv: ["tool"], result: "json" }),
		).toThrow(/operation-result\.v1/);
	});
});
