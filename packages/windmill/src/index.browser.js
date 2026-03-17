/**
 * @refarm.dev/windmill — browser-safe entrypoint
 *
 * WindmillEngine relies on Node.js APIs (node:path, isomorphic-git HTTP transport)
 * and cannot run in the browser. This stub satisfies TypeScript consumers but
 * throws a descriptive error at runtime when infrastructure operations are attempted.
 */

const BROWSER_ERROR =
  "[windmill] Infrastructure operations (git mirroring, DNS reconciliation, deployment) " +
  "require the Node.js runtime and cannot run in the browser.";

/**
 * Browser stub for WindmillEngine.
 */
export class WindmillEngine {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_config, _options = {}) {
    // no-op: allow construction in browser contexts
  }

  async pull() {
    throw new Error(BROWSER_ERROR);
  }

  async sync() {
    throw new Error(BROWSER_ERROR);
  }

  async deploy(_target = "all") {
    throw new Error(BROWSER_ERROR);
  }

  async _deployToTarget(_targetConfig) {
    throw new Error(BROWSER_ERROR);
  }
}

export { WindmillEngine as Windmill };
