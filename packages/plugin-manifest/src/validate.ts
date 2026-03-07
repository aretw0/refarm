import {
  REQUIRED_TELEMETRY_HOOKS,
  type ManifestValidationResult,
  type PluginManifest,
} from "./types.js";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

function hasDuplicates(values: string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validatePluginManifest(
  manifest: PluginManifest,
): ManifestValidationResult {
  const errors: string[] = [];

  if (!manifest.id || !manifest.id.startsWith("@")) {
    errors.push("id must be a non-empty scoped package name (e.g. @vendor/plugin)");
  }

  if (!manifest.name || manifest.name.trim().length < 3) {
    errors.push("name must be at least 3 characters");
  }

  if (!SEMVER_RE.test(manifest.version)) {
    errors.push("version must be valid semver");
  }

  if (!manifest.entry || !manifest.entry.endsWith(".js") || manifest.entry.startsWith("/")) {
    errors.push("entry must be a relative .js path");
  }

  if (!manifest.capabilities || manifest.capabilities.provides.length === 0) {
    errors.push("capabilities.provides must contain at least one capability");
  }

  if (hasDuplicates(manifest.capabilities.provides)) {
    errors.push("capabilities.provides must not contain duplicates");
  }

  if (hasDuplicates(manifest.capabilities.requires)) {
    errors.push("capabilities.requires must not contain duplicates");
  }

  if (hasDuplicates(manifest.permissions)) {
    errors.push("permissions must not contain duplicates");
  }

  const hooks = new Set(manifest.observability?.hooks ?? []);
  for (const requiredHook of REQUIRED_TELEMETRY_HOOKS) {
    if (!hooks.has(requiredHook)) {
      errors.push(`observability.hooks must include ${requiredHook}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValidPluginManifest(manifest: PluginManifest): void {
  const result = validatePluginManifest(manifest);
  if (!result.valid) {
    throw new Error(`Invalid plugin manifest: ${result.errors.join("; ")}`);
  }
}
