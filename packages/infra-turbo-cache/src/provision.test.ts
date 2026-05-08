import { describe, expect, it } from "vitest";
import type { CloudflareProvider, ExecResult } from "@refarm.dev/infra-cloudflare";
import { TurboCacheProvisioner } from "./provision.js";

interface ProviderCall {
  kind: "exec" | "stdin";
  args: string[];
  input?: string;
  cwd: string;
}

function createProvider(options: {
  execResults?: ExecResult[];
  execErrors?: Record<string, Error>;
} = {}) {
  const calls: ProviderCall[] = [];
  const execResults = [...(options.execResults ?? [])];
  const execErrors = options.execErrors ?? {};

  const provider: CloudflareProvider = {
    apiToken: "test-token",
    accountId: "test-account",
    env: () => ({ CLOUDFLARE_API_TOKEN: "test-token" }),
    exec: async (args: string[], cwd: string) => {
      calls.push({ kind: "exec", args, cwd });
      const key = args.join(" ");
      const error = execErrors[key];
      if (error) throw error;
      return execResults.shift() ?? { stdout: "", stderr: "" };
    },
    execWithStdin: async (args: string[], input: string, cwd: string) => {
      calls.push({ kind: "stdin", args, input, cwd });
      return { stdout: "", stderr: "" };
    },
  };

  return { provider, calls };
}

describe("TurboCacheProvisioner", () => {
  it("returns a dry-run envelope without calling Cloudflare", async () => {
    const { provider, calls } = createProvider();
    const provisioner = new TurboCacheProvisioner(provider);

    await expect(
      provisioner.provision({
        dryRun: true,
        bucketName: "refarm-cache-test",
        authToken: "provided-token",
      }),
    ).resolves.toEqual({
      workerUrl: "<dry-run>",
      authToken: "provided-token",
      bucketName: "refarm-cache-test",
    });

    expect(calls).toEqual([]);
  });

  it("creates the bucket, stores the secret, and deploys the worker", async () => {
    const { provider, calls } = createProvider({
      execResults: [
        { stdout: "bucket created", stderr: "" },
        { stdout: "Uploaded https://refarm-cache.example.workers.dev", stderr: "" },
      ],
    });
    const provisioner = new TurboCacheProvisioner(provider);

    const result = await provisioner.provision({
      bucketName: "refarm-cache-test",
      authToken: "provided-token",
    });

    expect(result).toEqual({
      workerUrl: "https://refarm-cache.example.workers.dev",
      authToken: "provided-token",
      bucketName: "refarm-cache-test",
    });
    expect(calls.map((call) => ({ kind: call.kind, args: call.args, input: call.input }))).toEqual([
      { kind: "exec", args: ["r2", "bucket", "create", "refarm-cache-test"], input: undefined },
      { kind: "stdin", args: ["secret", "put", "AUTH_TOKEN"], input: "provided-token" },
      { kind: "exec", args: ["deploy"], input: undefined },
    ]);
  });

  it("continues when the R2 bucket already exists", async () => {
    const { provider, calls } = createProvider({
      execErrors: {
        "r2 bucket create refarm-cache-test": new Error("bucket already exists"),
      },
      execResults: [
        { stdout: "https://refarm-cache.example.workers.dev", stderr: "" },
      ],
    });
    const provisioner = new TurboCacheProvisioner(provider);

    await expect(
      provisioner.provision({ bucketName: "refarm-cache-test", authToken: "provided-token" }),
    ).resolves.toMatchObject({ workerUrl: "https://refarm-cache.example.workers.dev" });
    expect(calls).toHaveLength(3);
  });

  it("surfaces unexpected bucket creation errors", async () => {
    const { provider } = createProvider({
      execErrors: {
        "r2 bucket create refarm-cache-test": new Error("permission denied"),
      },
    });
    const provisioner = new TurboCacheProvisioner(provider);

    await expect(
      provisioner.provision({ bucketName: "refarm-cache-test", authToken: "provided-token" }),
    ).rejects.toThrow("permission denied");
  });
});
