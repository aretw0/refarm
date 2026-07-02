import { refarmCommand } from "@refarm.dev/cli/command-handoff";

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
	"agent",
	"--json",
]);
