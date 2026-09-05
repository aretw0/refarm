import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT = path.resolve("scripts/operator-attention-gate.mjs");

function run(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("check-only sem preparo retorna nextCommand de preparo", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-attention-"));
  const result = run(["attention:demo", "--check-only", "--window-ms", "60000", "--json"], {
    REFARM_HOME: home,
  });

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.ok, false);
  assert.equal(payload.armed, false);
  assert.equal(typeof payload.nextCommand, "string");
  assert.ok(payload.nextCommand.includes("--prepare-only"));
  assert.ok(Array.isArray(payload.nextCommands));
  assert.equal(payload.nextCommands.length, 1);
});

test("prepare-only arma e check-only retorna pronto sem nextCommand", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-attention-"));

  const prepare = run(["attention:demo", "--prepare-only", "--window-ms", "60000", "--json"], {
    REFARM_HOME: home,
  });
  assert.equal(prepare.status, 0);

  const check = run(["attention:demo", "--check-only", "--window-ms", "60000", "--json"], {
    REFARM_HOME: home,
  });
  assert.equal(check.status, 0);
  const payload = JSON.parse(check.stdout.trim());
  assert.equal(payload.ok, true);
  assert.equal(payload.armed, true);
  assert.equal(payload.nextCommand, null);
  assert.ok(Array.isArray(payload.nextCommands));
  assert.equal(payload.nextCommands.length, 0);
});
