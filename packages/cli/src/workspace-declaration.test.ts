import { describe, expect, it } from "vitest";
import { deriveWorkspaceDeclaration } from "./workspace-declaration.js";

describe("deriveWorkspaceDeclaration", () => {
	const files = new Map([
		["/work/acme/package.json", JSON.stringify({ name: "@acme/my-app" })],
		[
			"/work/acme/.git/config",
			'[remote "origin"]\n  url = https://example.test/acme/my-app.git\n',
		],
	]);
	const readFile = (candidate: string): string => {
		const value = files.get(candidate);
		if (value === undefined) throw new Error("missing");
		return value;
	};

	it("derives a brand-neutral declaration with evidence", () => {
		expect(deriveWorkspaceDeclaration("/work/acme", {}, readFile)).toMatchObject({
			id: "my-app",
			entry: {
				path: "/work/acme",
				kind: "project",
				execution: { preferredAdapter: "auto" },
				repository: { url: "https://example.test/acme/my-app.git" },
			},
		});
	});

	it("refuses relative host paths", () => {
		expect(() => deriveWorkspaceDeclaration("./acme", {}, readFile)).toThrow(/must be absolute/);
	});

	it("keeps credentials out of declarations", () => {
		expect(() =>
			deriveWorkspaceDeclaration(
				"/work/acme",
				{ repository: "https://operator:secret@example.test/private.git" },
				readFile,
			),
		).toThrow(/contains credentials/);
	});

	it("omits an unsafe observed origin without making a local workspace unusable", () => {
		const secret = "operator:secret";
		const proposal = deriveWorkspaceDeclaration("/work/acme", {}, (candidate) => {
			if (candidate.endsWith("package.json")) return JSON.stringify({ name: "my-app" });
			return `[remote "origin"]\n  url = https://${secret}@example.test/private.git\n`;
		});

		expect(proposal.entry).not.toHaveProperty("repository");
		expect(proposal.warnings).toHaveLength(1);
		expect(JSON.stringify(proposal)).not.toContain(secret);
	});
});
