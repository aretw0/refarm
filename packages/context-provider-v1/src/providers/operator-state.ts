import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ContextEntry, ContextProvider, ContextRequest } from "../types.js";
import { CONTEXT_CAPABILITY } from "../types.js";

const execFileAsync = promisify(execFile);

interface ResumeFinish {
	status: string;
	failedCommand?: string | null;
	nextCommands?: string[];
	remainingCommands?: string[];
}

interface ResumeSession {
	shortId?: string;
	showCommand?: string;
}

export interface ResumeJson {
	ok?: boolean;
	finish?: ResumeFinish;
	session?: ResumeSession;
	nextCommands?: string[];
}

export class OperatorStateProvider implements ContextProvider {
	readonly name = "operator_state";
	readonly capability = CONTEXT_CAPABILITY;

	/** The app binary that answers `<binary> resume --json` (ADR-087) — injected,
	 *  never named by this generic package. REQUIRED, no default brand. */
	constructor(private readonly binary: string) {}

	async provide(request: ContextRequest): Promise<ContextEntry[]> {
		try {
			const result = await execFileAsync(this.binary, ["resume", "--json"], {
				cwd: request.cwd,
			});
			const parsed = JSON.parse(result.stdout) as ResumeJson;
			const entry = OperatorStateProvider.parseResumeJson(parsed, this.binary);
			return entry ? [entry] : [];
		} catch {
			return [];
		}
	}

	static parseResumeJson(parsed: ResumeJson, binary: string): ContextEntry | null {
		const lines: string[] = [`Operator state (${binary} resume):`];
		let hasContent = false;

		const finish = parsed.finish;
		if (finish?.status === "failed" && finish.failedCommand) {
			lines.push(`finish: FAILED — blocked at \`${finish.failedCommand}\``);
			const pending = [...(finish.nextCommands ?? []), ...(finish.remainingCommands ?? [])];
			if (pending.length > 0) {
				lines.push("Resolve before starting new work:");
				pending.forEach((cmd, i) => lines.push(`  ${i + 1}. ${cmd}`));
			}
			hasContent = true;
		} else if (finish?.status === "ok") {
			lines.push("finish: OK — last gate passed, clean state");
			hasContent = true;
		}

		const session = parsed.session;
		if (session?.shortId) {
			if (!hasContent) lines.push("finish: no recent gate recorded");
			const sessionLine = session.showCommand
				? `Session: ${session.shortId} (inspect: ${session.showCommand})`
				: `Session: ${session.shortId}`;
			lines.push(sessionLine);
			hasContent = true;
		}

		if (!hasContent) return null;
		return { label: "operator_state", content: lines.join("\n"), priority: 15 };
	}
}
