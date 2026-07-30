#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildOperatorAttentionGateCommands,
  buildOperatorAttentionGateHandoff,
} from "../packages/operator-state/dist/index.js";

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

function sanitizeScope(scope) {
  return scope.replace(/[^a-zA-Z0-9._:-]/g, "_");
}

function gateStatePath(scope) {
  const refarmHome = resolveRefarmHome();
  const dir = path.join(refarmHome, "operator-attention");
  ensureDir(dir);
  return path.join(dir, `${sanitizeScope(scope)}.json`);
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

export function armOperatorAttention(scope, windowMs, source = "operator-attention-gate") {
  const now = Date.now();
  const filePath = gateStatePath(scope);
  const state = readState(filePath);
  const nextState = {
    ...state,
    armedAt: now,
    armedIso: new Date(now).toISOString(),
    windowMs,
    source,
  };
  writeState(filePath, nextState);
  return {
    scope,
    armed: true,
    armedAt: nextState.armedAt,
    armedIso: nextState.armedIso,
    windowMs,
    expiresAt: new Date(now + windowMs).toISOString(),
  };
}

export function checkOperatorAttention(scope, defaultWindowMs) {
  const now = Date.now();
  const filePath = gateStatePath(scope);
  const state = readState(filePath);

  const armedAt = Number(state.armedAt ?? 0);
  const windowMs = Number(state.windowMs ?? defaultWindowMs);
  const ageMs = now - armedAt;
  const armed = Number.isFinite(armedAt) && armedAt > 0 && ageMs >= 0 && ageMs <= windowMs;

  return {
    scope,
    armed,
    armedAt: Number.isFinite(armedAt) && armedAt > 0 ? armedAt : 0,
    armedIso: typeof state.armedIso === "string" ? state.armedIso : null,
    windowMs,
    ageMs: Number.isFinite(ageMs) ? ageMs : Number.POSITIVE_INFINITY,
    expiresAt: armed ? new Date(armedAt + windowMs).toISOString() : null,
  };
}

export function consumeOperatorAttention(scope) {
  const filePath = gateStatePath(scope);
  const state = readState(filePath);
  const nextState = {
    ...state,
    armedAt: 0,
    armedIso: null,
  };
  writeState(filePath, nextState);
}

function parseArgs(argv) {
  const args = [...argv];
  let scope = null;
  let json = false;
  let prepareOnly = false;
  let checkOnly = false;
  let consumeOnly = false;
  let windowMs = Number(process.env.REFARM_OPERATOR_ATTENTION_WINDOW_MS ?? 5 * 60 * 1000);

  while (args.length > 0) {
    const token = args.shift();
    if (!token) continue;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--prepare-only") {
      prepareOnly = true;
      continue;
    }
    if (token === "--check-only") {
      checkOnly = true;
      continue;
    }
    if (token === "--consume-only") {
      consumeOnly = true;
      continue;
    }
    if (token === "--window-ms") {
      const raw = args.shift();
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error("--window-ms must be a positive number");
      }
      windowMs = parsed;
      continue;
    }
    if (token.startsWith("--")) {
      throw new Error(`unknown option: ${token}`);
    }
    if (scope === null) {
      scope = token;
      continue;
    }
    throw new Error(`unexpected extra argument: ${token}`);
  }

  if (!scope) {
    throw new Error(
      "usage: node scripts/operator-attention-gate.mjs <scope> [--prepare-only|--check-only|--consume-only] [--window-ms <ms>] [--json]",
    );
  }

  const modes = Number(prepareOnly) + Number(checkOnly) + Number(consumeOnly);
  if (modes > 1) {
    throw new Error("choose only one mode: --prepare-only, --check-only, or --consume-only");
  }

  return { scope, json, prepareOnly, checkOnly, consumeOnly, windowMs };
}

function emit(payload, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  process.stdout.write(`${payload.message}\n`);
}

function main() {
  const { scope, json, prepareOnly, checkOnly, consumeOnly, windowMs } = parseArgs(process.argv.slice(2));
  const commands = buildOperatorAttentionGateCommands(scope, windowMs);

  if (prepareOnly) {
    const armed = armOperatorAttention(scope, windowMs);
    emit(
      {
        ok: true,
        command: "operator-attention-gate",
        scope,
        prepared: true,
        windowMs,
        expiresAt: armed.expiresAt,
        nextAction: null,
        nextActions: [],
        nextCommand: null,
        nextCommands: [],
        message: `Canal de atenção armado para '${scope}' por ${Math.ceil(windowMs / 1000)}s.`,
      },
      json,
    );
    return;
  }

  if (consumeOnly) {
    consumeOperatorAttention(scope);
    emit(
      {
        ok: true,
        command: "operator-attention-gate",
        scope,
        consumed: true,
        nextAction: `Arme novamente quando houver nova ação sensível para '${scope}'.`,
        nextActions: [`Arme novamente quando houver nova ação sensível para '${scope}'.`],
        nextCommand: commands.prepare,
        nextCommands: [commands.prepare],
        message: `Canal de atenção consumido para '${scope}'.`,
      },
      json,
    );
    return;
  }

  const status = checkOperatorAttention(scope, windowMs);
  const handoff = buildOperatorAttentionGateHandoff({
    scope,
    armed: status.armed,
    windowMs: status.windowMs,
    expiresAt: status.expiresAt,
  });
  const payload = {
    ...handoff,
    checkOnly: true,
    message: status.armed
      ? `Canal de atenção pronto para '${scope}'.`
      : `Canal de atenção ainda não armado para '${scope}'.`,
  };
  emit(payload, json);
  process.exitCode = status.armed ? 0 : 2;
}

function isCliEntry() {
  const arg1 = process.argv[1];
  if (!arg1) return false;
  return import.meta.url === pathToFileURL(arg1).href;
}

if (isCliEntry()) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
