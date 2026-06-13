import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const configPath = resolve(rootDir, "packages/config/src/model-routing.js");
const piAgentPath = resolve(rootDir, "packages/pi-agent/src/provider_config.rs");

const config = await import(pathToFileURL(configPath));
const rustSource = await readFile(piAgentPath, "utf-8");

const commonCompatProviders = [
	"openai",
	"groq",
	"mistral",
	"xai",
	"deepseek",
	"together",
	"openrouter",
	"gemini",
	"ollama",
];

function rustStringConst(name) {
	const match = rustSource.match(
		new RegExp(`const\\s+${name}\\s*:\\s*&str\\s*=\\s*"([^"]+)"`),
	);
	return match?.[1];
}

function rustOpenAiCompatModels() {
	const entries = new Map();
	for (const provider of commonCompatProviders.filter((value) => value !== "ollama")) {
		const match = rustSource.match(
			new RegExp(`"${provider}"\\s*=>\\s*\\(\\s*"[^"]+"\\s*,\\s*"([^"]+)"\\s*,?\\s*\\)`),
		);
		if (match?.[1]) {
			entries.set(provider, match[1]);
		}
	}

	const fallback = rustSource.match(/_\s*=>\s*\("http:\/\/localhost:11434",\s*"([^"]+)"\)/);
	if (fallback?.[1]) {
		entries.set("ollama", fallback[1]);
	}
	return entries;
}

const rustDefaults = rustOpenAiCompatModels();
const failures = [];

function expectModel(provider, actual, expected, source) {
	if (actual === expected) return;
	failures.push(
		`${provider}: ${source} has ${actual ?? "<missing>"} but packages/config has ${expected ?? "<missing>"}`,
	);
}

for (const provider of commonCompatProviders) {
	expectModel(
		provider,
		rustDefaults.get(provider),
		config.defaultModelForProvider(provider),
		"pi-agent openai_compat_defaults",
	);
}

expectModel(
	"anthropic",
	rustStringConst("ANTHROPIC_DEFAULT_MODEL"),
	config.defaultModelForProvider("anthropic"),
	"pi-agent ANTHROPIC_DEFAULT_MODEL",
);

if (failures.length > 0) {
	console.error("Model default drift detected:");
	for (const failure of failures) {
		console.error(`  - ${failure}`);
	}
	console.error("");
	console.error(`Sources compared:`);
	console.error(`  - ${relative(rootDir, configPath)}`);
	console.error(`  - ${relative(rootDir, piAgentPath)}`);
	process.exit(1);
}

console.log("Model defaults aligned between packages/config and pi-agent.");
