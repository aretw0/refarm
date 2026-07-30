#!/usr/bin/env node
/**
 * farm-hello — a device says hello to the farm. Zero dependencies ON PURPOSE:
 * only Node ≥22 built-ins (global fetch + global WebSocket), so it runs
 * anywhere git and node reach — Termux on a phone, a Raspberry Pi, a laptop —
 * with `git pull && node scripts/farm-hello.mjs`. No pnpm install, no build.
 *
 * Usage:
 *   node scripts/farm-hello.mjs                   # AUTO-DISCOVER (tailnet, then LAN)
 *   node scripts/farm-hello.mjs serpro-1577853    # a MagicDNS name — no IP needed
 *   node scripts/farm-hello.mjs 192.168.0.10      # or point at a host explicitly
 *   FARM_HOST=192.168.0.10 node scripts/farm-hello.mjs
 *
 * Discovery ladder (first hit wins):
 *   0. Tailscale peers (if the `tailscale` CLI is here) — precise, works from
 *      ANY network. No IP typed. On a device without the CLI, pass the host's
 *      MagicDNS name (it resolves over the tailnet from anywhere).
 *   1. LAN broadcast + multicast — the opt-in announcer (refarm discover announce).
 *   2. LAN unicast /24 sweep — when the router filters broadcast/multicast.
 *
 * Then it probes the resolved host:
 *   - HTTP sidecar (http://<host>:42001/plugins) — is the control plane up?
 *   - CRDT WebSocket (ws://<host>:42000) — can this device join the sync mesh?
 */
import { networkInterfaces } from "node:os";
import { farmSyncWsProtocols } from "../src/auth.mjs";
import { defaultProbeTargets, discoverFarms, subnetSweepTargets } from "../src/beacon.mjs";
import { tailnetPeers } from "../src/tailnet.mjs";

const WS_PORT = Number(process.env.FARM_WS_PORT ?? 42000);

/** Does <host>:42000 accept a WS handshake? Used both to pick a tailnet peer
 *  and as the final sync check. Resolves {ok, detail}. When FARM_TOKEN is set
 *  (ADR-093, a gated farm), offers it as a `bearer.<token>` subprotocol — see
 *  `farmSyncWsProtocols`. Unset ⇒ no protocols offered, unchanged from before. */
function syncHandshake(host, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, detail) => {
      if (settled) return;
      settled = true;
      resolve({ ok, detail });
    };
    try {
      const ws = new WebSocket(`ws://${host}:${WS_PORT}`, farmSyncWsProtocols());
      const timer = setTimeout(() => {
        ws.close();
        done(false, "timeout after 5s");
      }, timeoutMs);
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

  // Dialeto 0: peers da tailnet (Tailscale) — preciso, funciona de QUALQUER rede.
  // O beacon UDP não cruza a tailnet; a lista de peers, sim. Probamos o sync de
  // cada peer diretamente (não precisa do anunciante).
  const peers = await tailnetPeers();
  if (peers.length > 0) {
    console.log(`🔎 Tailnet detectada — testando ${peers.length} peer(s)…`);
    for (const peer of peers) {
      const check = await syncHandshake(peer.ip, 3000);
      if (check.ok) return { host: peer.ip, via: `tailnet (${peer.name})` };
    }
    console.log("   nenhum peer da tailnet respondeu o sync (a fazenda está de pé lá?).");
  }

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
  console.log("   isolamento de clientes no roteador, firewall/EDR no host, ou redes distintas.");
  console.log("   Numa TAILNET (Tailscale), use o NOME do host — resolve de qualquer rede:");
  console.log("      node scripts/farm-hello.mjs <nome-do-host>   # ex.: serpro-1577853");
  console.log("   Ou o IP direto: node scripts/farm-hello.mjs <IP-do-host>");
  console.log("   (no host, `refarm discover announce --status` mostra o endereço mesh/LAN)");
  console.log("   Tentando localhost…");
  return { host: "127.0.0.1", via: "fallback localhost" };
}

const { host, via } = await resolveHost();
const HTTP_PORT = Number(process.env.FARM_HTTP_PORT ?? 42001);

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

console.log(`\n🌱 farm-hello — ${deviceName()} → ${host} (${via})\n`);

// The two capabilities are INDEPENDENT, not a single pass/fail:
//   sync  (ws :42000) — join the CRDT mesh. THIS is "you reached the farm".
//   sidecar (http :42001) — the control plane (efforts/chat). Loopback by
//     default ON PURPOSE; exposing it is a separate, deliberate decision.
const sync = await syncHandshake(host);
console.log(`${label(sync.ok)} sync     ws://${host}:${WS_PORT}    ${sync.detail}`);

const sidecar = await probeSidecar();
console.log(`${label(sidecar.ok)} sidecar  http://${host}:${HTTP_PORT}  ${sidecar.detail}`);

if (sync.ok) {
  console.log("\n🎉 Você alcançou a MALHA da fazenda — este dispositivo entra no sync CRDT.");
  if (sidecar.ok) {
    console.log("   E o plano de controle (efforts/chat) também responde. Alcance completo.\n");
  } else {
    console.log("   O plano de controle (sidecar :42001) está fechado em loopback POR PADRÃO.");
    console.log("   Para dirigir a fazenda (efforts/chat) daqui, exponha-o no host — de forma");
    console.log("   soberana, só na mesh (não na LAN corporativa). O daemon RECUSA um bind");
    console.log("   fora do loopback sem credencial, então são dois passos:");
    console.log("     refarm auth enroll                  # gera a credencial deste dispositivo");
    console.log("     export REFARM_AUTH_POLICY=<arquivo de política gerado>");
    console.log("     REFARM_HTTP_HOST=<IP-mesh-do-host> bash scripts/tractor-start.sh --background");
    console.log("     (ex.: REFARM_HTTP_HOST=100.105.71.127 — pega só a tailnet)\n");
  }
  process.exit(0);
}

console.log("\nEste dispositivo NÃO alcançou a malha. No host, verifique:");
console.log("  refarm runtime status                 # o daemon está de pé?");
// Era: "o WS :42000 já ouve em 0.0.0.0 — cobre LAN e tailnet por padrão". Isso deixou de
// ser verdade (e nunca deveria ter sido): o WS não tem NENHUMA checagem de credencial, e
// o daemon agora recusa bind fora do loopback nessa porta, com ou sem política.
console.log("  (o WS :42000 ouve SÓ em loopback — de propósito: essa porta não tem gate)");
console.log("  para alcançá-la de outro dispositivo, use uma frente autenticada/túnel;");
console.log("  o handshake de credencial do WS (ADR-093) ainda não existe.\n");
process.exit(1);
