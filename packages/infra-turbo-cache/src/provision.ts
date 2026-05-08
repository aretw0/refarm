import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CloudflareProvider } from "@refarm.dev/infra-cloudflare";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "worker");

export interface TurboCacheProvisionInput {
  bucketName?: string;
  workerName?: string;
  team?: string;
  authToken?: string;
  dryRun?: boolean;
}

export interface TurboCacheProvisionOutput {
  workerUrl: string;
  authToken: string;
  bucketName: string;
}

export class TurboCacheProvisioner {
  constructor(private readonly provider: CloudflareProvider) {}

  async provision(input: TurboCacheProvisionInput = {}): Promise<TurboCacheProvisionOutput> {
    const bucketName = input.bucketName ?? "refarm-turbo-cache";
    const authToken = input.authToken ?? randomBytes(32).toString("hex");

    if (input.dryRun) {
      return { workerUrl: "<dry-run>", authToken, bucketName };
    }

    await this.ensureBucket(bucketName);
    await this.setSecret("AUTH_TOKEN", authToken);
    const workerUrl = await this.deploy();

    return { workerUrl, authToken, bucketName };
  }

  private async ensureBucket(name: string): Promise<void> {
    try {
      await this.provider.exec(["r2", "bucket", "create", name], WORKER_DIR);
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
    }
  }

  private async setSecret(key: string, value: string): Promise<void> {
    await this.provider.execWithStdin(
      ["secret", "put", key],
      value,
      WORKER_DIR,
    );
  }

  private async deploy(): Promise<string> {
    const { stdout } = await this.provider.exec(["deploy"], WORKER_DIR);
    const match = stdout.match(/https:\/\/[^\s]+\.workers\.dev/);
    return match?.[0] ?? "<url-not-found>";
  }
}

function isAlreadyExists(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("already exists");
}
