import { refarmCommand } from "@refarm.dev/cli/command-handoff";

export const TREE_LIST_JSON_COMMAND = refarmCommand([
	"tree",
	"list",
	"--json",
]);
export const TREE_LIST_ALL_JSON_COMMAND = refarmCommand([
	"tree",
	"list",
	"--scope",
	"all",
	"--json",
]);
export const TREE_GIT_LIST_JSON_COMMAND = refarmCommand([
	"tree",
	"list",
	"--scope",
	"git",
	"--json",
]);
export const TREE_SESSION_LIST_JSON_COMMAND = refarmCommand([
	"tree",
	"list",
	"--scope",
	"session",
	"--json",
]);
