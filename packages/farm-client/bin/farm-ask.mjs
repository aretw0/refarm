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
 * Declare this dispatch's own budget — all optional, omit any/all to leave the
 * farm's own default/ceiling in charge:
 *   FARM_BUDGET_DEADLINE_MS=120000 FARM_BUDGET_MAX_TOKENS=50000 farm-ask "tarefa"
 *
 * It submits an effort to the farm's sidecar (POST /efforts) and polls the
 * result (GET /efforts/:id) until the agent answers.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cancellationExit, resolveFarmHost } from "../src/ask-host.mjs";
import { farmAuthHeaders } from "../src/auth.mjs";
import { buildRespondEffort } from "../src/effort.mjs";
import { extractAnswer, isSuccessEffort, isTerminalEffort } from "../src/effort-result.mjs";
import { createSpinner } from "../src/progress.mjs";
import {
  classifySidecarProbe,
  sidecarExposureLines,
  sidecarProbeFailureLines,
} from "../src/reach.mjs";
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`http://${host}:${HTTP_PORT}/plugins`, {
      signal: controller.signal,
      headers: farmAuthHeaders(),
    });
    return { ...classifySidecarProbe(res.status), status: res.status };
  } catch {
    return classifySidecarProbe(null);
  } finally {
    clearTimeout(timer);
  }
}

/** A escada inteira mora em `resolveFarmHost` (src/ask-host.mjs), que é pura de
 *  rede — aqui só se injeta O QUE É I/O: o probe do sidecar e os peers da
 *  tailnet. O último degrau é o novo: quando nada respondeu e o kit não conhece
 *  nome nenhum, ele PERGUNTA (só com terminal) em vez de explicar. */
function resolveHost() {
  return resolveFarmHost({
    kitRootDir: KIT_ROOT,
    explicit: process.env.FARM_HOST,
    probe: async (host) => (await sidecarUp(host)).reachable,
    peers: async () => (await tailnetPeers()).map((peer) => peer.ip),
  });
}

// Optional route: a worker-quota model (or any specific model) via env.
// Absent → the farm's default route decides.
const route = {
  ...(process.env.FARM_PROVIDER ? { provider: process.env.FARM_PROVIDER } : {}),
  ...(process.env.FARM_MODEL ? { model: process.env.FARM_MODEL } : {}),
};

// Optional budget declaration via env, same absent-means-absent contract as the
// route above. Raw env strings ride straight into buildRespondEffort, which
// calls the kit's ONE budget validator (parseBudgetDeclaration, src/effort.mjs)
// — this file never re-checks the numbers itself, so the CLI and any other
// caller can never drift on what counts as a valid ceiling.
const budgetEnv = {
  deadlineMs: process.env.FARM_BUDGET_DEADLINE_MS,
  maxTokens: process.env.FARM_BUDGET_MAX_TOKENS,
  maxUsd: process.env.FARM_BUDGET_MAX_USD,
};

// Um Ctrl+C na pergunta é uma REJEIÇÃO do bloco de prompt, não um crash: sai
// com uma linha e o código de SIGINT, nunca com um stack trace na cara.
let host;
try {
  ({ host } = await resolveHost());
} catch (err) {
  const code = cancellationExit(err);
  if (code !== null) process.exit(code);
  throw err;
}
const base = `http://${host}:${HTTP_PORT}`;

const sidecar = await sidecarUp(host);
if (!sidecar.usable) {
  for (const line of sidecarProbeFailureLines(sidecar, base)) console.error(line);
  // Era: "No host: REFARM_HTTP_HOST=0.0.0.0 bash scripts/tractor-start.sh --background".
  // Isso mandava o operador contornar a própria declaração e abrir a porta em TODAS as
  // interfaces — o footgun exato que o trabalho de `surfaces` existe para remover.
  if (!sidecar.reachable) for (const line of sidecarExposureLines()) console.error(line);
  console.error(`   Alcance primeiro com: node ${join(KIT_ROOT, "bin", "farm-hello.mjs")} ${host}`);
  process.exit(1);
}

const routeLabel = route.model ? ` [${route.provider ?? "?"}/${route.model}]` : "";
console.log(`\n🌱 farm-ask → ${host}${routeLabel}\n▸ ${prompt}\n`);

// Build (and validate) the effort BEFORE any network call, so an invalid
// FARM_BUDGET_* value fails at the surface with a message naming the field,
// never as a mysterious node-side rejection after a request already left.
let effort;
try {
  effort = buildRespondEffort(prompt, { ...route, ...budgetEnv });
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(2);
}

let effortId;
try {
  const res = await fetch(`${base}/efforts`, {
    method: "POST",
    headers: { "content-type": "application/json", ...farmAuthHeaders() },
    body: JSON.stringify(effort),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  effortId = (await res.json()).effortId;
} catch (err) {
  console.error(`❌ falha ao submeter: ${err.message}`);
  process.exit(1);
}

const deadline = Date.now() + 120_000; // agents can take a while
const spinner = createSpinner({ label: "aguardando a fazenda…" }).start();
let last = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 800));
  let result;
  try {
    const res = await fetch(`${base}/efforts/${effortId}`, { headers: farmAuthHeaders() });
    if (res.status === 404) continue; // not registered yet
    result = await res.json();
  } catch {
    continue;
  }
  last = result;
  if (!isTerminalEffort(result.status)) {
    if (result.status) spinner.setLabel(`fazenda: ${result.status}…`);
    continue;
  }
  spinner.stop();

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

spinner.stop();
console.error(`⏳ tempo esgotado (último status: ${last?.status ?? "desconhecido"})`);
process.exit(1);
