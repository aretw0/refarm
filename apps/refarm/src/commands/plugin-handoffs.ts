import { refarmCommand } from "./command-handoff.js";

export const PLUGIN_INSTALL_COMMAND = refarmCommand(["plugin", "install"]);
export const PLUGIN_INSTALL_JSON_COMMAND = refarmCommand([
	"plugin",
	"install",
	"--json",
]);
export const PLUGIN_STATUS_JSON_COMMAND = refarmCommand([
	"plugin",
	"status",
	"--json",
]);
export const RUNTIME_AGENT_RELOAD_JSON_COMMAND = refarmCommand([
	"plugin",
	"reload",
	"runtime-agent",
	"--json",
]);
export const PI_AGENT_RELOAD_JSON_COMMAND = RUNTIME_AGENT_RELOAD_JSON_COMMAND;
