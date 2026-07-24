#!/usr/bin/env node
/**
 * farm-ask — ask the farm a question from any device. The daily driver, in your
 * pocket: type a prompt, the farm's agent runs it with the HOST's model and
 * returns the answer. Zero dependencies (Node ≥22 global fetch + crypto), so it
 * runs from `git pull` on Termux or a Raspberry — nothing installed but git+node.
 *
 * Usage:
 *   FARM_HOST=serpro-1577853 farm-ask "quem é você?"
 *   farm-ask "olá"                          # FARM_HOST unset → tailnet, then localhost
 *
 * Route to a specific model (e.g. a worker-quota model) — omit to use the
 * farm's default route:
 *   FARM_PROVIDER=openai-codex FARM_MODEL=gpt-5.3-codex-spark farm-ask "tarefa"
 *
 * It submits an effort to the farm's sidecar (POST /efforts) and polls the
 * result (GET /efforts/:id) until the agent answers.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRespondEffort } from "../src/effort.mjs";
import { extractAnswer, isSuccessEffort, isTerminalEffort } from "../src/effort-result.mjs";
import { readRememberedHost } from "../src/farm-host.mjs";
import { tailnetPeers } from "../src/tailnet.mjs";
import { formatUsage, parseUsage } from "../src/usage.mjs";

// This kit's root (bin/..), where farm-update remembered the farm it came from.
const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const HTTP_PORT = Number(process.env.FARM_HTTP_PORT ?? 42001);
const prompt = process.argv.slice(2).join(" ").trim();

if (!prompt) {
  console.error('Uso: FARM_HOST=<nome-ou-ip> node scripts/farm-ask.mjs "sua pergunta"');
  process.exit(2);
}

/** Does <host>:42001 answer /plugins? (the sidecar is up and reachable) */
async function sidecarUp(host) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://${host}:${HTTP_PORT}/plugins`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveHost() {
  // 1) Explicit override always wins.
  const explicit = process.env.FARM_HOST;
  if (explicit) return explicit;
  // 2) The farm this kit was installed from (farm-update remembered it) — the
  //    device's default, so a name given once at update time need not repeat.
  const remembered = await readRememberedHost(KIT_ROOT);
  if (remembered && (await sidecarUp(remembered))) return remembered;
  // 3) Tailnet auto-discovery (when the tailscale CLI is present), then localhost.
  for (const peer of await tailnetPeers()) {
    if (await sidecarUp(peer.ip)) return peer.ip;
  }
  return "127.0.0.1";
}

// Optional route: a worker-quota model (or any specific model) via env.
// Absent → the farm's default route decides.
const route = {
  ...(process.env.FARM_PROVIDER ? { provider: process.env.FARM_PROVIDER } : {}),
  ...(process.env.FARM_MODEL ? { model: process.env.FARM_MODEL } : {}),
};

const host = await resolveHost();
const base = `http://${host}:${HTTP_PORT}`;

if (!(await sidecarUp(host))) {
  console.error(`❌ sidecar inalcançável em ${base}`);
  console.error("   A fazenda expõe o sidecar? No host: REFARM_HTTP_HOST=0.0.0.0 bash scripts/tractor-start.sh --background");
  console.error("   Alcance primeiro com: node scripts/farm-hello.mjs " + host);
  process.exit(1);
}

const routeLabel = route.model ? ` [${route.provider ?? "?"}/${route.model}]` : "";
console.log(`\n🌱 farm-ask → ${host}${routeLabel}\n▸ ${prompt}\n`);

let effortId;
try {
  const res = await fetch(`${base}/efforts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildRespondEffort(prompt, route)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  effortId = (await res.json()).effortId;
} catch (err) {
  console.error(`❌ falha ao submeter: ${err.message}`);
  process.exit(1);
}

const deadline = Date.now() + 120_000; // agents can take a while
let last = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 800));
  let result;
  try {
    const res = await fetch(`${base}/efforts/${effortId}`);
    if (res.status === 404) continue; // not registered yet
    result = await res.json();
  } catch {
    continue;
  }
  last = result;
  if (!isTerminalEffort(result.status)) continue;

  const answer = extractAnswer(result);
  if (isSuccessEffort(result.status) && answer) {
    console.log(`${answer}\n`);
    // Usage footer → stderr, so stdout stays the pure answer (pipeable). This is
    // the "spend visibility everyone has": tokens in/out (+ reasoning/cached) and
    // the estimated cost, so context bloat is felt at a glance.
    const usageLine = formatUsage(parseUsage(result));
    if (usageLine) console.error(`\x1b[2m${usageLine}\x1b[0m`);
    process.exit(0);
  }
  console.error(`❌ o agente terminou em '${result.status}'${answer ? `: ${answer}` : ""}`);
  process.exit(1);
}

console.error(`⏳ tempo esgotado (último status: ${last?.status ?? "desconhecido"})`);
process.exit(1);
