#!/usr/bin/env node
/**
 * farm-announce — the farm raises its hand on the LAN (OPT-IN).
 *
 * Run this on the host beside the daemon and any device running farm-hello (or
 * a future wizard) finds the farm without anyone typing an IP. Zero
 * dependencies; answers only well-formed probes; announces only what a LAN
 * scan could already see (hostname + ports). Stop with Ctrl+C.
 *
 * Usage:
 *   node scripts/farm-announce.mjs                # announce ws:42000 http:42001
 *   FARM_NAME=quinta node scripts/farm-announce.mjs
 */
import { createFarmAnnouncer, FARM_BEACON_PORT } from "../src/beacon.mjs";

const announcer = await createFarmAnnouncer({
  ...(process.env.FARM_NAME ? { name: process.env.FARM_NAME } : {}),
  ...(process.env.FARM_WS_PORT ? { wsPort: Number(process.env.FARM_WS_PORT) } : {}),
  ...(process.env.FARM_HTTP_PORT ? { httpPort: Number(process.env.FARM_HTTP_PORT) } : {}),
});

console.log(`📣 farm-announce escutando probes em udp/${FARM_BEACON_PORT}`);
console.log("   Dispositivos com `node scripts/farm-hello.mjs` (sem IP) vão me encontrar.");
console.log("   Ctrl+C para parar de anunciar.\n");

process.on("SIGINT", async () => {
  await announcer.close();
  process.exit(0);
});
