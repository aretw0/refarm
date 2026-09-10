import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

/**
 * PURE-ish. Where the bundled `wrangler` lives — resolved WHEN NEEDED, never at load.
 *
 * MEASURED 2026-08-19: this was a module-level `require.resolve`, and `wrangler` is a
 * devDependency. So importing this package at all required a dependency that production installs
 * deliberately omit, on a node that may never touch Cloudflare — the failure met while testing
 * whether this node could run an installed copy of itself.
 *
 * The repository already draws this line: the delivery adapter registry is imported only when a
 * channel is declared, which is what makes the undeclared path free rather than merely quiet. An
 * optional capability must not make its dependency mandatory.
 *
 * The refusal names the decision rather than the resolver's file: `Cannot find module
 * 'wrangler/package.json'` tells an operator about a path nobody chose.
 */
export function defaultWranglerBin(resolve: (specifier: string) => string = require.resolve): string {
	try {
		return join(dirname(resolve("wrangler/package.json")), "bin", "wrangler.js");
	} catch {
		throw new Error(
			"this node has no `wrangler` installed, and Cloudflare work runs through it. Install it, " +
				"or pass an explicit `wranglerBin` — production installs omit devDependencies on purpose.",
		);
	}
}

export interface CloudflareProviderOptions {
	apiToken: string;
	accountId?: string;
	wranglerBin?: string;
}

export interface ExecResult {
	stdout: string;
	stderr: string;
}

export class CloudflareProvider {
	readonly apiToken: string;
	readonly accountId: string;
	readonly wranglerBin: string;

	private constructor(apiToken: string, accountId: string, wranglerBin: string) {
		this.apiToken = apiToken;
		this.accountId = accountId;
		this.wranglerBin = wranglerBin;
	}

	static async create(opts: CloudflareProviderOptions): Promise<CloudflareProvider> {
		const accountId = opts.accountId ?? (await resolveAccountId(opts.apiToken));
		return new CloudflareProvider(
			opts.apiToken,
			accountId,
			opts.wranglerBin ?? defaultWranglerBin(),
		);
	}

	env(): NodeJS.ProcessEnv {
		return { ...process.env, CLOUDFLARE_API_TOKEN: this.apiToken };
	}

	async getWorkersSubdomain(): Promise<string | null> {
		return getWorkersSubdomain(this.apiToken, this.accountId);
	}

	async registerWorkersSubdomain(subdomain: string): Promise<string> {
		return registerWorkersSubdomain(this.apiToken, this.accountId, subdomain);
	}

	// Token is passed via env, never interpolated into the args array.
	async exec(args: string[], cwd: string): Promise<ExecResult> {
		return execFileAsync(this.wranglerBin, args, { cwd, env: this.env() });
	}

	// For commands that require piping a secret to stdin (wrangler secret put).
	execWithStdin(args: string[], input: string, cwd: string): Promise<ExecResult> {
		return new Promise((resolve, reject) => {
			const proc = spawn(this.wranglerBin, args, {
				cwd,
				env: this.env(),
				stdio: ["pipe", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			proc.stdout?.on("data", (d: Buffer) => {
				stdout += d.toString();
			});
			proc.stderr?.on("data", (d: Buffer) => {
				stderr += d.toString();
			});
			proc.stdin?.write(input);
			proc.stdin?.end();

			proc.on("close", (code) => {
				if (code === 0) resolve({ stdout, stderr });
				else reject(new Error(`wrangler ${args[0] ?? ""} exited ${code}\n${stderr}`));
			});
			proc.on("error", reject);
		});
	}
}

async function resolveAccountId(apiToken: string): Promise<string> {
	const timeoutMs = 15_000;
	const res = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=1", {
		headers: { Authorization: `Bearer ${apiToken}` },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok) {
		throw new Error(`Cloudflare API error ${res.status}: ${await res.text()}`);
	}
	const body = (await res.json()) as { result: Array<{ id: string; name: string }> };
	const first = body.result[0];
	if (!first) throw new Error("No Cloudflare accounts found for this token.");
	return first.id;
}

/**
 * Returns the current workers.dev subdomain for the account, or null if none is registered.
 */
export async function getWorkersSubdomain(
	apiToken: string,
	accountId: string,
): Promise<string | null> {
	const timeoutMs = 15_000;
	const res = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
		{
			headers: { Authorization: `Bearer ${apiToken}` },
			signal: AbortSignal.timeout(timeoutMs),
		},
	);
	if (!res.ok) return null;
	const body = (await res.json()) as { result: { subdomain?: string } };
	return body.result?.subdomain ?? null;
}

/**
 * Registers a workers.dev subdomain for the account.
 * Returns the registered subdomain on success.
 * Cloudflare requires the name to be globally unique across workers.dev.
 */
export async function registerWorkersSubdomain(
	apiToken: string,
	accountId: string,
	subdomain: string,
): Promise<string> {
	const timeoutMs = 15_000;
	const res = await fetch(
		`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
		{
			method: "PUT",
			headers: {
				Authorization: `Bearer ${apiToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ subdomain }),
			signal: AbortSignal.timeout(timeoutMs),
		},
	);
	const body = (await res.json()) as {
		success: boolean;
		result?: { subdomain?: string };
		errors?: Array<{ message: string }>;
	};
	if (!body.success) {
		const msg = body.errors?.[0]?.message ?? "unknown error";
		throw new Error(`Failed to register workers.dev subdomain: ${msg}`);
	}
	return body.result?.subdomain ?? subdomain;
}
