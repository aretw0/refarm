#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildOperatorAttentionGateCommands } from "../packages/operator-state/dist/index.js";
import {
  armOperatorAttention,
  checkOperatorAttention,
  consumeOperatorAttention,
} from "./operator-attention-gate.mjs";

function parseArgs(argv) {
  const args = [...argv];
  let name = null;
  let force = false;
  let json = false;
  let prepareOnly = false;
  let checkReadinessOnly = false;
  let cooldownMs = Number(process.env.REFARM_CONNECTION_COOLDOWN_MS ?? 10 * 60 * 1000);
  let readyWindowMs = Number(process.env.REFARM_CONNECTION_READY_WINDOW_MS ?? 5 * 60 * 1000);

  while (args.length > 0) {
    const token = args.shift();
    if (!token) continue;
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--prepare-only") {
      prepareOnly = true;
      continue;
    }
    if (token === "--check-readiness-only") {
      checkReadinessOnly = true;
      continue;
    }
    if (token === "--cooldown-ms") {
      const raw = args.shift();
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error("--cooldown-ms must be a non-negative number");
      }
      cooldownMs = parsed;
      continue;
    }
    if (token === "--ready-window-ms") {
      const raw = args.shift();
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--ready-window-ms must be a positive number");
      }
      readyWindowMs = parsed;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`unknown option: ${token}`);
    }
    if (name === null) {
      name = token;
      continue;
    }
    throw new Error(`unexpected extra argument: ${token}`);
  }

  if (!name) {
    throw new Error(
      "usage: node scripts/connection-up-safe.mjs <connection-name> [--prepare-only] [--check-readiness-only] [--ready-window-ms <ms>] [--cooldown-ms <ms>] [--force] [--json]",
    );
  }

  return { name, cooldownMs, readyWindowMs, force, json, prepareOnly, checkReadinessOnly };
}

function resolveRefarmHome() {
  const envHome = process.env.REFARM_HOME?.trim();
  if (envHome) return envHome;

  const cwdRefarm = path.join(process.cwd(), ".refarm");
  if (fs.existsSync(cwdRefarm)) return cwdRefarm;

  return path.join(os.homedir(), ".refarm");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function statePathFor(name) {
  const refarmHome = resolveRefarmHome();
  const dir = path.join(refarmHome, "connection-guardrails");
  ensureDir(dir);
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(dir, `${safeName}.json`);
}

function readState(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeState(filePath, state) {
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function runRefarm(args) {
  const result = spawnSync("refarm", args, { encoding: "utf8" });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

function parseJson(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function print(result, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  process.stdout.write(`${result.message}\n`);
}

function main() {
  const { name, cooldownMs, readyWindowMs, force, json, prepareOnly, checkReadinessOnly } = parseArgs(
    process.argv.slice(2),
  );

  const stateFile = statePathFor(name);
  const now = Date.now();
  const state = readState(stateFile);
  const attentionScope = `connection-up:${name}`;
  const attentionCommands = buildOperatorAttentionGateCommands(attentionScope, readyWindowMs);
  const prepareCommand = `node scripts/connection-up-safe.mjs ${name} --prepare-only --ready-window-ms ${readyWindowMs} --json`;

  if (prepareOnly) {
    const armed = armOperatorAttention(attentionScope, readyWindowMs, "connection-up-safe:prepare");
    const result = {
      ok: true,
      command: "connection-up-safe",
      connection: name,
      prepared: true,
      reason: "operator-armed",
      readyWindowMs,
      scope: attentionScope,
      expiresAt: armed.expiresAt,
      nextAction: `Quando estiver pronto, execute a tentativa segura para '${name}'.`,
      nextActions: [`Quando estiver pronto, execute a tentativa segura para '${name}'.`],
      nextCommand: `node scripts/connection-up-safe.mjs ${name} --ready-window-ms ${readyWindowMs} --cooldown-ms ${cooldownMs} --json`,
      nextCommands: [`node scripts/connection-up-safe.mjs ${name} --ready-window-ms ${readyWindowMs} --cooldown-ms ${cooldownMs} --json`],
      message:
        `Operador preparado para '${name}'. Janela ativa por ${Math.ceil(readyWindowMs / 1000)}s ` +
        `para executar a subida com segurança.`,
    };
    print(result, json);
    return;
  }

  const attention = checkOperatorAttention(attentionScope, readyWindowMs);
  const lastAttemptAt = Number(state.lastAttemptAt ?? 0);
  const elapsed = now - lastAttemptAt;
  const cooldownActive = lastAttemptAt > 0 && elapsed >= 0 && elapsed < cooldownMs;

  if (checkReadinessOnly) {
    const operatorArmed = attention.armed;
    const readiness = {
      ok: operatorArmed && !cooldownActive,
      command: "connection-up-safe",
      connection: name,
      checkOnly: true,
      scope: attentionScope,
      operatorArmed,
      cooldownActive,
      readyWindowMs: attention.windowMs,
      armedExpiresAt: attention.expiresAt,
      cooldownRetryAfterMs: cooldownActive ? cooldownMs - elapsed : 0,
      nextAction: operatorArmed
        ? cooldownActive
          ? `Aguarde o cooldown de '${name}' terminar.`
          : null
        : `Arme o preparo explícito para '${name}' (ou execute ${attentionCommands.prepare}).`,
      nextActions: operatorArmed
        ? cooldownActive
          ? [`Aguarde o cooldown de '${name}' terminar.`]
          : []
        : [`Arme o preparo explícito para '${name}' (ou execute ${attentionCommands.prepare}).`],
      nextCommand: operatorArmed
        ? null
        : prepareCommand,
      nextCommands: operatorArmed
        ? []
        : [prepareCommand],
      message: operatorArmed
        ? cooldownActive
          ? `Preparado, mas em cooldown por ${Math.ceil((cooldownMs - elapsed) / 1000)}s.`
          : "Pronto para tentativa segura de subida."
        : `Ainda não preparado. Execute: node scripts/connection-up-safe.mjs ${name} --prepare-only`,
    };
    print(readiness, json);
    process.exitCode = readiness.ok ? 0 : 2;
    return;
  }

  if (!force && !attention.armed) {
    const result = {
      ok: false,
      command: "connection-up-safe",
      connection: name,
      blocked: true,
      reason: "operator-not-armed",
      scope: attentionScope,
      nextAction: `Arme o preparo explícito para '${name}' (ou execute ${attentionCommands.prepare}).`,
      nextActions: [`Arme o preparo explícito para '${name}' (ou execute ${attentionCommands.prepare}).`],
      nextCommand: prepareCommand,
      nextCommands: [prepareCommand],
      message:
        `Guardrail ativo: preparação explícita obrigatória antes de subir '${name}'. ` +
        `Execute: node scripts/connection-up-safe.mjs ${name} --prepare-only`,
    };
    print(result, json);
    process.exitCode = 2;
    return;
  }

  if (!force && lastAttemptAt > 0 && elapsed >= 0 && elapsed < cooldownMs) {
    const retryAfterMs = cooldownMs - elapsed;
    const result = {
      ok: false,
      command: "connection-up-safe",
      connection: name,
      blocked: true,
      reason: "cooldown-active",
      cooldownMs,
      retryAfterMs,
      nextAllowedAt: new Date(now + retryAfterMs).toISOString(),
      nextAction: `Aguarde ${Math.ceil(retryAfterMs / 1000)}s antes da próxima tentativa de '${name}'.`,
      nextActions: [`Aguarde ${Math.ceil(retryAfterMs / 1000)}s antes da próxima tentativa de '${name}'.`],
      nextCommand: null,
      nextCommands: [],
      message:
        `Guardrail ativo: tentativa de subir '${name}' bloqueada por cooldown. ` +
        `Aguarde ${Math.ceil(retryAfterMs / 1000)}s ou use --force.`,
    };
    print(result, json);
    process.exitCode = 2;
    return;
  }

  const status = runRefarm(["connection", "status", "--json"]);
  if (status.error || status.exitCode !== 0) {
    const result = {
      ok: false,
      command: "connection-up-safe",
      connection: name,
      blocked: true,
      reason: "status-failed",
      nextAction: `Cheque o runtime e repita a tentativa segura de '${name}'.`,
      nextActions: [`Cheque o runtime e repita a tentativa segura de '${name}'.`],
      nextCommand: "refarm runtime ensure --wait",
      nextCommands: ["refarm runtime ensure --wait"],
      message: "Não foi possível obter refarm connection status --json antes da tentativa.",
      stderr: status.stderr,
    };
    print(result, json);
    process.exitCode = 1;
    return;
  }

  const statusJson = parseJson(status.stdout);
  const connections = Array.isArray(statusJson?.connections) ? statusJson.connections : [];
  const connection = connections.find((entry) => entry?.name === name);
  const stateLabel = typeof connection?.state === "string" ? connection.state : "unknown";

  if (stateLabel === "up") {
    const result = {
      ok: true,
      command: "connection-up-safe",
      connection: name,
      skipped: true,
      reason: "already-up",
      nextAction: null,
      nextActions: [],
      nextCommand: null,
      nextCommands: [],
      message: `Conexão '${name}' já está up. Nenhuma nova tentativa foi feita.`,
    };
    print(result, json);
    return;
  }

  writeState(stateFile, {
    ...state,
    lastAttemptAt: now,
    lastAttemptIso: new Date(now).toISOString(),
    cooldownMs,
    source: "connection-up-safe",
  });
  consumeOperatorAttention(attentionScope);

  const up = runRefarm(["connection", "up", name, "--json"]);
  const upJson = parseJson(up.stdout);
  const ok = Boolean(upJson?.ok) && up.exitCode === 0;

  if (json) {
    process.stdout.write(`${up.stdout}`);
  } else {
    if (up.stdout.trim()) process.stdout.write(`${up.stdout.trim()}\n`);
    if (up.stderr.trim()) process.stderr.write(`${up.stderr.trim()}\n`);
  }

  process.exitCode = ok ? 0 : 1;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
