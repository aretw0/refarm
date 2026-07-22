#!/usr/bin/env node
/**
 * farm-hello — a device says hello to the farm. Zero dependencies ON PURPOSE:
 * only Node ≥22 built-ins (global fetch + global WebSocket), so it runs
 * anywhere git and node reach — Termux on a phone, a Raspberry Pi, a laptop —
 * with `git pull && node scripts/farm-hello.mjs`. No pnpm install, no build.
 *
 * Usage:
 *   node scripts/farm-hello.mjs                   # AUTO-DISCOVER the farm on the LAN
 *   node scripts/farm-hello.mjs 192.168.0.10      # or point at a host explicitly
 *   FARM_HOST=192.168.0.10 node scripts/farm-hello.mjs
 *
 * Auto-discovery asks the LAN (UDP broadcast) for an opt-in announcer — start
 * `node scripts/farm-announce.mjs` beside the daemon. No announcer answering →
 * this script says so and falls back to localhost.
 *
 * Probes, in order:
 *   1. HTTP sidecar (http://<host>:42001/plugins) — is the farm's control plane up?
 *   2. CRDT WebSocket (ws://<host>:42000) — can this device join the sync mesh?
 */
import { networkInterfaces } from "node:os";
import { defaultProbeTargets, discoverFarms, subnetSweepTargets } from "./lib/farm-beacon.mjs";

function localPrefixes() {
  const prefixes = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      prefixes.push(entry.address.split(".").slice(0, 3).join("."));
    }
  }
  return prefixes;
}

function pickFarm(farms, via) {
  // The SAME farm can answer from several addresses (loopback, VPN, Wi-Fi) —
  // group by name, prefer the address on one of THIS device's subnets.
  const byName = new Map();
  for (const farm of farms) {
    const list = byName.get(farm.name) ?? [];
    list.push(farm);
    byName.set(farm.name, list);
  }
  if (byName.size > 1) {
    console.log("🔎 Mais de uma fazenda respondeu — escolha uma:");
    for (const [name, list] of byName) {
      console.log(`   node scripts/farm-hello.mjs ${list[0].address}   # ${name}`);
    }
    process.exit(1);
  }
  const candidates = [...byName.values()][0];
  const prefixes = localPrefixes();
  const preferred =
    candidates.find((farm) => prefixes.includes(farm.address.split(".").slice(0, 3).join("."))) ??
    candidates[0];
  return { host: preferred.address, via: `${via} (${preferred.name})` };
}

async function resolveHost() {
  const explicit = process.argv[2] ?? process.env.FARM_HOST;
  if (explicit) return { host: explicit, via: "explícito" };

  // Dialeto 1+2: broadcast + multicast — o caminho barato quando o roteador deixa.
  const targets = defaultProbeTargets();
  const farms = await discoverFarms({ targets });
  if (farms.length > 0) return pickFarm(farms, "descoberto");

  // Dialeto 3: varredura unicast da /24 — roteadores que filtram broadcast e
  // multicast entre clientes normalmente ainda passam unicast direto.
  const sweep = subnetSweepTargets();
  if (sweep.length > 0) {
    console.log(`🔎 Broadcast/multicast sem resposta — varrendo a sub-rede (${sweep.length} endereços, unicast)…`);
    const swept = await discoverFarms({ targets: sweep, timeoutMs: 2500 });
    if (swept.length > 0) return pickFarm(swept, "descoberto por varredura");
  }

  console.log("🔎 Nenhuma fazenda respondeu em nenhum dialeto. Onde procurei:");
  for (const target of targets) {
    console.log(`   ${target.address} (broadcast/multicast)`);
  }
  if (sweep.length > 0) console.log(`   + varredura unicast de ${sweep.length} endereços da sub-rede`);
  console.log("   Possíveis causas: anunciante parado no host (refarm discover announce),");
  console.log("   isolamento total de clientes no roteador, ou redes distintas.");
  console.log("   Teste direto: node scripts/farm-hello.mjs <IP-do-host>");
  console.log("   (no host, `refarm discover announce --status` lista os IPs da fazenda)");
  console.log("   Se nem o teste direto passar, o caminho é o rail P2P (spec do Pears).");
  console.log("   Tentando localhost…");
  return { host: "127.0.0.1", via: "fallback localhost" };
}

const { host, via } = await resolveHost();
const HTTP_PORT = Number(process.env.FARM_HTTP_PORT ?? 42001);
const WS_PORT = Number(process.env.FARM_WS_PORT ?? 42000);

const label = (ok) => (ok ? "✅" : "❌");

function deviceName() {
  const parts = [process.platform, process.arch];
  if (process.env.TERMUX_VERSION) parts.push(`termux ${process.env.TERMUX_VERSION}`);
  return parts.join("/");
}

async function probeSidecar() {
  const url = `http://${host}:${HTTP_PORT}/plugins`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      ok: true,
      detail: `responder=${body.defaultResponder ?? "none"} loaded=[${(body.loaded ?? []).join(", ")}]`,
    };
  } catch (err) {
    return { ok: false, detail: err.cause?.code ?? err.message };
  }
}

function probeSync() {
  const url = `ws://${host}:${WS_PORT}`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };
    try {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        done(false, "timeout after 5s");
      }, 5000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        done(true, "handshake accepted — this device can join the mesh");
        ws.close();
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        done(false, "connection refused");
      });
    } catch (err) {
      done(false, err.message);
    }
  });
}

console.log(`\n🌱 farm-hello — ${deviceName()} → ${host} (${via})\n`);

const sidecar = await probeSidecar();
console.log(`${label(sidecar.ok)} sidecar  http://${host}:${HTTP_PORT}  ${sidecar.detail}`);

const sync = await probeSync();
console.log(`${label(sync.ok)} sync     ws://${host}:${WS_PORT}    ${sync.detail}`);

if (sidecar.ok && sync.ok) {
  console.log("\n🎉 A fazenda responde. Este dispositivo alcança o runtime.\n");
  process.exit(0);
}
console.log("\nA fazenda não respondeu por completo. No host, verifique:");
console.log("  refarm runtime status        # o daemon está de pé?");
console.log("  tractor --http-host 0.0.0.0  # o sidecar precisa ouvir além do loopback");
console.log("  (o WS :42000 já ouve em todas as interfaces por padrão)\n");
process.exit(1);
