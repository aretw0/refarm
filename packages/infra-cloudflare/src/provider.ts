import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CloudflareProviderOptions {
  apiToken: string;
  accountId?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export class CloudflareProvider {
  readonly apiToken: string;
  readonly accountId: string;

  private constructor(apiToken: string, accountId: string) {
    this.apiToken = apiToken;
    this.accountId = accountId;
  }

  static async create(opts: CloudflareProviderOptions): Promise<CloudflareProvider> {
    const accountId = opts.accountId ?? (await resolveAccountId(opts.apiToken));
    return new CloudflareProvider(opts.apiToken, accountId);
  }

  env(): NodeJS.ProcessEnv {
    return { ...process.env, CLOUDFLARE_API_TOKEN: this.apiToken };
  }

  // Token is passed via env, never interpolated into the args array.
  async exec(args: string[], cwd: string): Promise<ExecResult> {
    return execFileAsync("wrangler", args, { cwd, env: this.env() });
  }

  // For commands that require piping a secret to stdin (wrangler secret put).
  execWithStdin(args: string[], input: string, cwd: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn("wrangler", args, {
        cwd,
        env: this.env(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
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
  const res = await fetch("https://api.cloudflare.com/client/v4/accounts?per_page=1", {
    headers: { Authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) throw new Error(`Cloudflare API error ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { result: Array<{ id: string }> };
  const first = body.result[0];
  if (!first) throw new Error("No Cloudflare accounts found for this token.");
  return first.id;
}
