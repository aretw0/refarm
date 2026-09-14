import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT = path.resolve("scripts/connection-up-safe.mjs");

function run(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("prepare-only arma janela de operador", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-guardrail-"));
  const result = run(["ovpn-serpro", "--prepare-only", "--ready-window-ms", "60000", "--json"], {
    REFARM_HOME: home,
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.ok, true);
  assert.equal(payload.prepared, true);
  assert.equal(payload.reason, "operator-armed");

  const gatePath = path.join(home, "operator-attention", "connection-up:ovpn-serpro.json");
  const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
  assert.equal(gate.windowMs, 60000);
  assert.ok(Number(gate.armedAt) > 0);
});

test("subida sem preparo explícito é bloqueada", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-guardrail-"));
  const result = run(["ovpn-serpro", "--json"], { REFARM_HOME: home });

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.ok, false);
  assert.equal(payload.blocked, true);
  assert.equal(payload.reason, "operator-not-armed");
  assert.equal(typeof payload.nextCommand, "string");
  assert.ok(Array.isArray(payload.nextCommands));
  assert.equal(payload.nextCommands.length, 1);
});

test("check-readiness-only reporta not-ready sem efeitos colaterais", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-guardrail-"));
  const result = run(["ovpn-serpro", "--check-readiness-only", "--json"], {
    REFARM_HOME: home,
  });

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.checkOnly, true);
  assert.equal(payload.ok, false);
  assert.equal(payload.operatorArmed, false);
  assert.equal(payload.cooldownActive, false);
  assert.equal(typeof payload.nextCommand, "string");
  assert.ok(Array.isArray(payload.nextCommands));
  assert.equal(payload.nextCommands.length, 1);
});

test("prepare-only usa escopo genérico de atenção de operador", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-guardrail-"));
  const result = run(["ovpn-serpro", "--prepare-only", "--ready-window-ms", "60000", "--json"], {
    REFARM_HOME: home,
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.scope, "connection-up:ovpn-serpro");

  const gatePath = path.join(home, "operator-attention", "connection-up:ovpn-serpro.json");
  const gate = JSON.parse(fs.readFileSync(gatePath, "utf8"));
  assert.equal(gate.windowMs, 60000);
  assert.ok(Number(gate.armedAt) > 0);
});
