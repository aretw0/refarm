// Kernel Bridge - Host implementation for refarm:sdk/kernel-bridge
// This file is versioned so CI can always resolve bridge imports.

const mockStorage = new Map();
let logCallback = null;

export function setLogCallback(callback) {
  logCallback = callback;
}

export function log(level, message) {
  if (logCallback) {
    const levelNames = ['debug', 'info', 'warn', 'error'];
    logCallback(levelNames[level] || 'info', message);
  }
}

export function storeNode(jsonLd) {
  try {
    const node = JSON.parse(jsonLd);
    const id = node['@id'] || `urn:node:${Date.now()}`;
    mockStorage.set(id, node);
    return id;
  } catch (e) {
    throw new Error(`Invalid JSON-LD: ${e.message}`);
  }
}

export function getNode(id) {
  const node = mockStorage.get(id);
  if (node) {
    return JSON.stringify(node);
  }
  throw new Error(`Node not found: ${id}`);
}

export function queryNodes(nodeType, limit) {
  const results = [];
  for (const [, node] of mockStorage) {
    if (node['@type'] === nodeType && results.length < limit) {
      results.push(JSON.stringify(node));
    }
  }
  return { tag: 'ok', val: results };
}

export function fetch(_req) {
  return {
    tag: 'err',
    val: {
      tag: 'not-permitted',
      val: 'HTTP fetch not enabled in validation host'
    }
  };
}

export function requestPermission(_capability, _reason) {
  return false;
}
