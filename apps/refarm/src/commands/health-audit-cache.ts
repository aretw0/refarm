import { readGitCommand } from "@refarm.dev/cli/git-command";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
	resolveHealthPolicyReport,
	type HealthPolicyReport,
} from "./health-policy.js";
import type { HealthReport } from "./health.js";

const HEALTH_AUDIT_CACHE_VERSION = 2;
const HEALTH_AUDIT_CACHE_FILE = "health-audit.json";
const HEALTH_AUDIT_CACHE_MAX_AGE_MS = 5 * 60_000;
const HEALTH_PROJECT_STATE_FINGERPRINT_FILES = [
  ".project/automations.json",
];
const HEALTH_FINGERPRINT_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const HEALTH_FINGERPRINT_SKIP_DIRS = new Set([
  ".git",
  ".refarm",
  ".turbo",
  "benchmarks",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "pkg",
  "target",
  "test-results",
  "tmp",
]);
const HEALTH_STATUS_PATHSPECS = [
  ":(glob)**/.gitignore",
  ":(glob)**/package.json",
  ":(glob)**/Cargo.toml",
  ":(glob)**/refarm.config.json",
  ":(glob)**/tsconfig.json",
  ":(glob)**/tsconfig.build.json",
  ":(glob)**/turbo.json",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "pnpm-lock.yaml",
  ".cargo",
  ".changeset",
  ".devcontainer",
  ".github",
  ".project",
  ".refarm",
];

export interface HealthAuditCacheEntry {
  version: number;
  fingerprint: string;
  createdAt: string;
  report: HealthReport;
}

export function buildHealthAuditFingerprint(
  rootDir: string,
  policyReport = resolveHealthPolicyReport(rootDir),
): string {
  const gitFingerprint = buildGitHealthAuditFingerprint(rootDir, policyReport);
  if (gitFingerprint) return gitFingerprint;

  const root = path.resolve(rootDir);
  const hash = createHealthFingerprintHash(root, policyReport);

  for (const relativePath of healthFingerprintFiles(root)) {
    appendHealthFingerprintFile(hash, root, relativePath);
  }

  return hash.digest("hex");
}

function buildGitHealthAuditFingerprint(
  rootDir: string,
  policyReport: HealthPolicyReport,
): string | null {
  if (policyReport.policy.complexity?.enabled) return null;
  const root = path.resolve(rootDir);
  try {
    const gitRoot = path.resolve(readGitCommand(["rev-parse", "--show-toplevel"], { cwd: root }));
    if (gitRoot !== root) return null;
    const hash = createHealthFingerprintHash(root, policyReport);
    appendGitTrackedHealthFileMetadata(hash, root);
    const status = readGitCommand(
      [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
        ...HEALTH_STATUS_PATHSPECS,
      ],
      { cwd: root },
    );
    const statusEntries = gitPorcelainStatusEntries(status);
    appendHealthFingerprintValue(
      hash,
      "git:health-status",
      statusEntries
        .filter((entry) => entry.paths.some(isHealthAuditRelevantStatusPath))
        .map((entry) => `${entry.code} ${entry.paths.join("\0")}`)
        .sort()
        .join("\0"),
    );
    appendGitChangedPathMetadata(
      hash,
      root,
      statusEntries.flatMap((entry) =>
        entry.paths.filter(isHealthAuditRelevantStatusPath)
      ),
    );
    return hash.digest("hex");
  } catch {
    return null;
  }
}

function appendGitTrackedHealthFileMetadata(
  hash: ReturnType<typeof createHash>,
  rootDir: string,
): void {
  const tracked = readGitCommand(["ls-files", "-s", "-z"], { cwd: rootDir });
  const entries = gitTrackedFileEntries(tracked)
    .map((entry) => ({
      ...entry,
      path: normalizeHealthFingerprintPath(entry.path),
    }))
    .filter((entry) => isHealthAuditRelevantStatusPath(entry.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  const files = entries.map((entry) => entry.path);
  appendHealthFingerprintValue(hash, "git:tracked-health-files", files.join("\0"));
  for (const entry of entries) {
    appendHealthFingerprintValue(
      hash,
      "git:tracked-health-file",
      JSON.stringify(entry),
    );
  }
}

function gitTrackedFileEntries(
  tracked: string,
): Array<{ mode: string; object: string; stage: string; path: string }> {
  return tracked
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const match = /^(\d+) ([0-9a-f]+) (\d+)\t(.+)$/s.exec(entry);
      if (!match) return null;
      return {
        mode: match[1]!,
        object: match[2]!,
        stage: match[3]!,
        path: match[4]!,
      };
    })
    .filter(
      (
        entry,
      ): entry is { mode: string; object: string; stage: string; path: string } =>
        Boolean(entry),
    );
}

function createHealthFingerprintHash(
  rootDir: string,
  policyReport: HealthPolicyReport,
): ReturnType<typeof createHash> {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    version: HEALTH_AUDIT_CACHE_VERSION,
    configPath: path.relative(rootDir, policyReport.configPath),
    configFound: policyReport.configFound,
    source: policyReport.source,
    policy: policyReport.policy,
  }));
  hash.update("\0");
  return hash;
}

function appendHealthFingerprintValue(
  hash: ReturnType<typeof createHash>,
  label: string,
  value: string,
): void {
  hash.update(label);
  hash.update("\0");
  hash.update(value);
  hash.update("\0");
}

function appendGitChangedPathMetadata(
  hash: ReturnType<typeof createHash>,
  rootDir: string,
  changedPaths: string[],
): void {
  const paths = new Set<string>();
  for (const relativePath of changedPaths) {
    paths.add(relativePath);
  }
  for (const relativePath of [...paths].sort()) {
    if (!isHealthFingerprintFile(relativePath)) continue;
    appendHealthFingerprintFile(hash, rootDir, relativePath, {
      includeContentHash: true,
    });
  }
}

function gitPorcelainStatusEntries(status: string): Array<{ code: string; paths: string[] }> {
  const parsed: Array<{ code: string; paths: string[] }> = [];
  const entries = status.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const relativePath = entry.slice(3);
    const paths = relativePath ? [relativePath] : [];
    if ((code.includes("R") || code.includes("C")) && entries[index + 1]) {
      paths.push(entries[index + 1]!);
      index += 1;
    }
    if (paths.length > 0) parsed.push({ code, paths });
  }
  return parsed;
}

function isHealthAuditRelevantStatusPath(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const base = path.basename(normalized);
  if (
    base === ".gitignore" ||
    base === "package.json" ||
    base === "Cargo.toml" ||
    base === "refarm.config.json" ||
    base === "tsconfig.json" ||
    base === "tsconfig.build.json" ||
    base === "turbo.json" ||
    base === "pnpm-workspace.yaml" ||
    base === "package-lock.json" ||
    base === "pnpm-lock.yaml"
  ) {
    return true;
  }
  return (
    normalized === ".project/automations.json" ||
    normalized === ".refarm/config.json" ||
    normalized.startsWith(".cargo/") ||
    normalized.startsWith(".changeset/") ||
    normalized.startsWith(".devcontainer/") ||
    normalized.startsWith(".github/") ||
    normalized.startsWith(".project/") ||
    normalized.startsWith(".refarm/")
  );
}

function healthAuditCachePath(rootDir: string): string {
  return path.join(rootDir, ".refarm", "cache", HEALTH_AUDIT_CACHE_FILE);
}

export function readHealthAuditCache(
  rootDir: string,
  fingerprint: string,
): HealthReport | null {
  try {
    const raw = fs.readFileSync(healthAuditCachePath(rootDir), "utf-8");
    const parsed = JSON.parse(raw) as HealthAuditCacheEntry;
    if (parsed.version !== HEALTH_AUDIT_CACHE_VERSION) return null;
    if (parsed.fingerprint !== fingerprint) return null;
    if (!isFreshHealthAuditCacheEntry(parsed)) return null;
    if (!isHealthReport(parsed.report)) return null;
    if (!parsed.report.ok || parsed.report.issueCount !== 0) return null;
    return parsed.report;
  } catch {
    return null;
  }
}

function isFreshHealthAuditCacheEntry(entry: HealthAuditCacheEntry): boolean {
  const createdAtMs = Date.parse(entry.createdAt);
  return (
    Number.isFinite(createdAtMs) &&
    Date.now() - createdAtMs >= 0 &&
    Date.now() - createdAtMs <= HEALTH_AUDIT_CACHE_MAX_AGE_MS
  );
}

export function writeHealthAuditCache(
  rootDir: string,
  fingerprint: string,
  report: HealthReport,
): void {
  if (!report.ok || report.issueCount !== 0) return;
  const cachePath = healthAuditCachePath(rootDir);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tempPath = `${cachePath}.${process.pid}.tmp`;
    const entry: HealthAuditCacheEntry = {
      version: HEALTH_AUDIT_CACHE_VERSION,
      fingerprint,
      createdAt: new Date().toISOString(),
      report,
    };
    fs.writeFileSync(tempPath, `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
    fs.renameSync(tempPath, cachePath);
  } catch {
    // Health cache is an optimization only; diagnostics must still work without it.
  }
}

function isHealthReport(value: unknown): value is HealthReport {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as HealthReport).command === "health" &&
      (value as HealthReport).operation === "audit" &&
      typeof (value as HealthReport).ok === "boolean" &&
      typeof (value as HealthReport).issueCount === "number",
  );
}

function healthFingerprintFiles(rootDir: string): string[] {
  const files: string[] = [];
  collectHealthFingerprintFiles(rootDir, rootDir, files);
  for (const relativePath of HEALTH_PROJECT_STATE_FINGERPRINT_FILES) {
    if (fs.existsSync(path.join(rootDir, relativePath))) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

function collectHealthFingerprintFiles(
  rootDir: string,
  currentPath: string,
  files: string[],
): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(currentPath);
  } catch {
    return;
  }

  const relativePath = normalizeHealthFingerprintPath(
    path.relative(rootDir, currentPath),
  );
  if (stats.isDirectory()) {
    const directoryName = path.basename(currentPath);
    if (
      relativePath &&
      (directoryName.startsWith(".") ||
        HEALTH_FINGERPRINT_SKIP_DIRS.has(directoryName))
    ) {
      return;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(currentPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      collectHealthFingerprintFiles(rootDir, path.join(currentPath, entry), files);
    }
    return;
  }

  if (!relativePath) return;
  if (isHealthFingerprintFile(relativePath)) files.push(relativePath);
}

function isHealthFingerprintFile(relativePath: string): boolean {
  return (
    path.basename(relativePath) === ".gitignore" ||
    HEALTH_FINGERPRINT_EXTENSIONS.has(path.extname(relativePath))
  );
}

function appendHealthFingerprintFile(
  hash: ReturnType<typeof createHash>,
  rootDir: string,
  relativePath: string,
  options: { includeContentHash?: boolean } = {},
): void {
  const absolutePath = path.join(rootDir, relativePath);
  try {
    const stats = fs.lstatSync(absolutePath);
    const contentHash =
      options.includeContentHash && stats.isFile()
        ? createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex")
        : null;
    hash.update(JSON.stringify({
      path: relativePath,
      type: stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "dir" : "file",
      size: stats.size,
      mode: stats.mode,
      mtimeMs: stats.mtimeMs,
      ctimeMs: stats.ctimeMs,
      link: stats.isSymbolicLink() ? fs.readlinkSync(absolutePath) : null,
      contentHash,
    }));
    hash.update("\0");
  } catch {
    hash.update(JSON.stringify({ path: relativePath, missing: true }));
    hash.update("\0");
  }
}

function normalizeHealthFingerprintPath(value: string): string {
  return value.split(path.sep).join("/");
}
