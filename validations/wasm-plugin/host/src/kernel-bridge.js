// validations/wasm-plugin/host/src/kernel-bridge.js

let logCallback = null;

/**
 * Sets the callback for logging to the UI.
 * Used by main.ts.
 */
export function setLogCallback(callback) {
  logCallback = callback;
}

/**
 * Implementation of refarm:sdk/kernel-bridge.log
 */
export function log(level, message) {
  const levelStr = typeof level === 'object' ? level.tag : level;
  console.log(`[WASM] [${levelStr}] ${message}`);
  if (logCallback) {
    logCallback(levelStr, message);
  }
}

/**
 * Implementation of refarm:sdk/kernel-bridge.store-node
 * Note: jco wraps the return value of this function in an 'ok' variant automatically.
 * To signal an error, throw an exception.
 */
export function storeNode(jsonLd) {
  const node = JSON.parse(jsonLd);
  const id = node['@id'] || `urn:refarm:node:${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[Host] Storing node: ${id}`);
  
  // In a real host, this would persist to a database or state manager.
  // For validation, we just return the ID string.
  return id;
}

/**
 * Implementation of refarm:sdk/kernel-bridge.get-node
 */
export function getNode(id) {
  console.log(`[Host] Getting node: ${id}`);
  // Mock implementation for validation
  return JSON.stringify({ "@id": id, "type": "MockNode" });
}
