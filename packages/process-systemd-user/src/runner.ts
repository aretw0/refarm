import { execFile } from "node:child_process";

/**
 * The ONE piece of I/O this package performs, behind an interface.
 *
 * `spawned` is the field that matters and is the reason this is not just "did it exit zero": a
 * command that never ran and a command that ran and said no are the difference between
 * `could-not-ask` and `not-running`, which is the whole three-way distinction the contract insists
 * on. Collapsing them here would make it unrecoverable everywhere above.
 */
export interface CommandResult {
	/** False when the binary could not be executed at all (missing, not permitted). */
	spawned: boolean;
	code: number | null;
	stdout: string;
	stderr: string;
}

export interface CommandRunner {
	run(command: string, args: readonly string[]): Promise<CommandResult>;
}

/** Never let a probe hang the CLI: a supervisor that does not answer is `could-not-ask`. */
export const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

export function createNodeCommandRunner(
	options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): CommandRunner {
	const timeout = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
	return {
		run(command, args) {
			return new Promise<CommandResult>((resolve) => {
				let settled = false;
				const settle = (result: CommandResult): void => {
					if (settled) return;
					settled = true;
					resolve(result);
				};
				const notFound = (): void =>
					settle({ spawned: false, code: null, stdout: "", stderr: `${command}: not found` });

				const child = execFile(
					command,
					[...args],
					{ timeout, encoding: "utf8", ...(options.env ? { env: options.env } : {}) },
					(error, stdout, stderr) => {
						if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
							notFound();
							return;
						}
						const code =
							error && typeof (error as { code?: unknown }).code === "number"
								? (error as { code: number }).code
								: error
									? 1
									: 0;
						settle({ spawned: true, code, stdout: stdout ?? "", stderr: stderr ?? "" });
					},
				);

				// Belt AND braces, and the braces are load-bearing: a probe that never settles would
				// hang the CLI, and `execFile`'s callback is not the only way this can end. Listening
				// on the child covers a spawn that fails before the callback path is reached at all.
				child.on("error", (error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") notFound();
					else settle({ spawned: false, code: null, stdout: "", stderr: error.message });
				});
				child.on("close", (code) => {
					settle({ spawned: true, code: code ?? null, stdout: "", stderr: "" });
				});
			});
		},
	};
}
