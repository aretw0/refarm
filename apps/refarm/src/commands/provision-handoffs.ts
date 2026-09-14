import { refarmCommand } from "../brand.js";

export const SOW_CLOUDFLARE_COMMAND = refarmCommand(["sow", "--cloudflare"]);
export const SOW_CLOUDFLARE_JSON_COMMAND = refarmCommand(["sow", "--cloudflare", "--json"]);

export const PROVISION_CLOUDFLARE_TURBO_CACHE_DRY_RUN_COMMAND = refarmCommand([
	"provision",
	"cloudflare",
	"turbo-cache",
	"--dry-run",
]);

export const PROVISION_CLOUDFLARE_TURBO_CACHE_DRY_RUN_JSON_COMMAND = refarmCommand([
	"provision",
	"cloudflare",
	"turbo-cache",
	"--dry-run",
	"--json",
]);

export const PROVISION_CLOUDFLARE_TURBO_CACHE_GITHUB_SECRETS_COMMAND = refarmCommand([
	"provision",
	"cloudflare",
	"turbo-cache",
	"--github-secrets",
]);

export const PROVISION_CLOUDFLARE_TURBO_CACHE_GITHUB_SECRETS_JSON_COMMAND = refarmCommand([
	"provision",
	"cloudflare",
	"turbo-cache",
	"--github-secrets",
	"--json",
]);