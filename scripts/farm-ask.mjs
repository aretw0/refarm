#!/usr/bin/env node
/**
 * farm-ask — ask the farm a question from any device. The daily driver, in your
 * pocket: type a prompt, the farm's agent runs it with the HOST's model and
 * returns the answer. Zero dependencies (Node ≥22 global fetch + crypto), so it
 * runs from `git pull` on Termux or a Raspberry — nothing installed but git+node.
 *
 * Usage:
 *   FARM_HOST=serpro-1577853 node scripts/farm-ask.mjs "quem é você?"
 *   node scripts/farm-ask.mjs "olá"        # FARM_HOST unset → tailnet, then localhost
 *
 * It submits an effort to the farm's sidecar (POST /efforts) and polls the
 * result (GET /efforts/:id) until the agent answers.
 */
import { extractAnswer, isSuccessEffort, isTerminalEffort } from "./lib/effort-result.mjs";
import { tailnetPeers } from "./lib/tailnet.mjs";

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
  const explicit = process.env.FARM_HOST;
  if (explicit) return explicit;
  // Tailnet peers first (works from any network), then localhost.
  for (const peer of await tailnetPeers()) {
    if (await sidecarUp(peer.ip)) return peer.ip;
  }
  return "127.0.0.1";
}

function uuid() {
  return crypto.randomUUID();
}

function buildEffort(text) {
  return {
    id: uuid(),
    direction: "ask",
    tasks: [
      {
        id: uuid(),
        pluginId: "@refarm/agent",
        fn: "respond",
        args: { prompt: text, history_turns: 0 },
      },
    ],
    source: "farm-ask",
    submittedAt: new Date().toISOString(),
  };
}

const host = await resolveHost();
const base = `http://${host}:${HTTP_PORT}`;

if (!(await sidecarUp(host))) {
  console.error(`❌ sidecar inalcançável em ${base}`);
  console.error("   A fazenda expõe o sidecar? No host: REFARM_HTTP_HOST=0.0.0.0 bash scripts/tractor-start.sh --background");
  console.error("   Alcance primeiro com: node scripts/farm-hello.mjs " + host);
  process.exit(1);
}

console.log(`\n🌱 farm-ask → ${host}\n▸ ${prompt}\n`);

let effortId;
try {
  const res = await fetch(`${base}/efforts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildEffort(prompt)),
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
    process.exit(0);
  }
  console.error(`❌ o agente terminou em '${result.status}'${answer ? `: ${answer}` : ""}`);
  process.exit(1);
}

console.error(`⏳ tempo esgotado (último status: ${last?.status ?? "desconhecido"})`);
process.exit(1);
