/**
 * `refarm auth remote` — the declaration, asked from outside the source file.
 *
 * A closed-by-default rule the operator cannot inspect is a rule they have to take on faith. These
 * tests are about the inspection, not the rule (whose teeth are in
 * `src/commands/remote-initiation.test.ts`): that the answer is complete, that it says what the
 * silence means, and that it does not quietly promise the operator's own commands are included.
 */

import { describe, expect, it, vi } from "vitest";

import { createAuthRemoteCommand } from "../../src/commands/auth-remote.js";
import { REMOTELY_INITIABLE_OPERATIONS } from "../../src/commands/remote-initiation.js";

async function run(args: string[]): Promise<string> {
	const chunks: string[] = [];
	// Both doors: the prose path writes to `process.stdout`, `printJson` goes through
	// `console.log`. Capturing one and not the other is how a JSON assertion silently reads "".
	const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
		chunks.push(String(chunk));
		return true;
	});
	const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
		chunks.push(`${parts.join(" ")}\n`);
	});
	try {
		await createAuthRemoteCommand().parseAsync(args, { from: "user" });
	} finally {
		write.mockRestore();
		log.mockRestore();
	}
	return chunks.join("");
}

describe("refarm auth remote", () => {
	it("lists every declared operation, with the reason it is open", async () => {
		const output = await run([]);
		for (const operation of REMOTELY_INITIABLE_OPERATIONS) {
			expect(output).toContain(`refarm ${operation.id}`);
			expect(output).toContain(operation.why);
		}
	});

	it("says what the silence means, so an absent operation is not read as an oversight", async () => {
		const output = await run([]);
		expect(output).toMatch(/does not declare itself remotely\s+initiable may not be started/);
	});

	it("points the operator's OWN commands at the door they actually use", async () => {
		// The two doors must not blur: a declared workspace command is the operator's argv and
		// keeps its allowlist. Someone reading this list must not conclude their `vpn` command is
		// now startable from a phone.
		const output = await run([]);
		expect(output).toContain("refarm workspace run <workspace> <command>");
		expect(output).toContain(".refarm/config.json");
	});

	it("answers --json with the handoff envelope every JSON command carries", async () => {
		const payload = JSON.parse(await run(["--json"])) as {
			ok: boolean;
			command: string;
			operation: string;
			closedByDefault: boolean;
			operations: { id: string; command: string; why: string }[];
			nextCommand: string | null;
			nextCommands: string[];
		};
		expect(payload.ok).toBe(true);
		expect(payload.command).toBe("auth");
		expect(payload.operation).toBe("remote");
		expect(payload.closedByDefault).toBe(true);
		expect(payload.operations.map((entry) => entry.id)).toEqual(
			REMOTELY_INITIABLE_OPERATIONS.map((entry) => entry.id),
		);
		expect(payload.nextCommand).toBe("refarm auth list --json");
		expect(payload.nextCommands).toEqual(["refarm auth list --json"]);
	});

	it("reads no policy file — the answer is a property of the build, not of who is enrolled", async () => {
		// `auth list` answers WHO; this answers WHAT. Conflating them would let an empty device
		// list read as if it narrowed this one.
		const output = await run(["--json"]);
		expect(output).not.toContain("auth-policy.json");
		expect(createAuthRemoteCommand().options.map((option) => option.long)).toEqual(["--json"]);
	});
});
