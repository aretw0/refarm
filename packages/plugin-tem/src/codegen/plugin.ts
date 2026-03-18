/**
 * Codegen WIT bridge — `codegen-api` interface implementation.
 *
 * Wraps the pure `bundleToTypeScript` and `validateBundleShapes` functions
 * from `weights-to-ts.ts` for the WIT/Worker interface.
 *
 * Architecture: core logic (weights-to-ts.ts) is pure TypeScript;
 * this file is a thin transport adapter — no business logic here.
 */

import { bundleToTypeScript, validateBundleShapes } from "./weights-to-ts";
import type { WeightsBundle } from "../core/weights";

type Ok<T> = { tag: "ok"; val: T };
type Err = { tag: "err"; val: string };

function ok<T>(val: T): Ok<T> {
  return { tag: "ok", val };
}

function err(message: string): Err {
  return { tag: "err", val: message };
}

function parseBundle(bundleJson: string): WeightsBundle | Error {
  try {
    const parsed = JSON.parse(bundleJson);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return new Error("bundle-json must be a JSON object");
    }
    return parsed as WeightsBundle;
  } catch (e) {
    return new Error(`Invalid JSON: ${(e as Error).message}`);
  }
}

export const codegenApi = {
  /**
   * Validate a WeightsBundle JSON against the expected tensor shapes.
   * Returns the detected config as JSON string on success.
   */
  validateBundle(bundleJson: string): Ok<string> | Err {
    const bundle = parseBundle(bundleJson);
    if (bundle instanceof Error) return err(bundle.message);

    try {
      validateBundleShapes(bundle);
      return ok(JSON.stringify(bundle.config));
    } catch (e) {
      return err((e as Error).message);
    }
  },

  /**
   * Generate a TypeScript source file from a WeightsBundle JSON.
   * Returns the complete `.ts` source string on success.
   */
  generateWeightsTs(bundleJson: string): Ok<string> | Err {
    const bundle = parseBundle(bundleJson);
    if (bundle instanceof Error) return err(bundle.message);

    try {
      return ok(bundleToTypeScript(bundle));
    } catch (e) {
      return err((e as Error).message);
    }
  },
};
