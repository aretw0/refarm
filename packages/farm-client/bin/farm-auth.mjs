#!/usr/bin/env node
/** Manage this device's credential without putting the secret in argv or a shell profile. */
import { createStdioOperatorChannel } from "../vendor/prompt-contract-v1/dist/index.js";
import {
	farmCredentialStatus,
	farmTokenFile,
	removeFarmToken,
	saveFarmToken,
} from "../src/auth.mjs";

const action = process.argv[2] ?? "status";
const path = farmTokenFile();

if (action === "status") {
	const status = farmCredentialStatus();
	if (status.ready) {
		console.log(`🔑 credencial pronta (${status.source === "environment" ? "FARM_TOKEN" : status.path})`);
		process.exit(0);
	}
	console.error(`🔒 credencial não está pronta (${status.issue})`);
	console.error(`   arquivo: ${status.path}`);
	console.error("   configure sem expor no histórico: farm-auth set");
	process.exit(1);
}

if (!process.stdin.isTTY || !process.stdout.isTTY) {
	console.error("❌ farm-auth set/remove exige um terminal para decidir sem expor o segredo.");
	process.exit(2);
}
const operator = createStdioOperatorChannel();

if (action === "set") {
	const token = await operator.ask({
		type: "secret",
		question: "Cole a credencial deste aparelho",
		visibleTail: 4,
	});
	await saveFarmToken(token);
	console.log(`✓ credencial guardada em ${path} (modo 0600)`);
	console.log("  FARM_TOKEN continua disponível como override temporário.");
	process.exit(0);
}

if (action === "remove") {
	const confirmed = await operator.ask({
		type: "confirm",
		question: `Remover a credencial guardada em ${path}?`,
		default: false,
	});
	if (!confirmed) {
		console.log("Nada foi removido.");
		process.exit(0);
	}
	await removeFarmToken();
	console.log(`✓ credencial removida de ${path}`);
	process.exit(0);
}

console.error("Uso: farm-auth set | status | remove");
process.exit(2);
