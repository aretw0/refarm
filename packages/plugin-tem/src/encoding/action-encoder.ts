/**
 * Action encoder for TEM.
 *
 * Maps TelemetryEvent.event strings to integer action indices,
 * then produces a 1-hot Float32Array for the TEM action (g-stream) input.
 *
 * The action space represents transitions in the capability/resource graph:
 * "what API call or event triggered the move to this new graph position?"
 *
 * Mapping is intentionally explicit (not learned) so it's auditable and
 * extensible. New event types are added to ACTION_VOCAB below; unknown
 * events fall back to ACTION_UNKNOWN (index 0).
 *
 * @see docs/research/tem-sovereign-graph-design.md (D4)
 */

/** Total number of action dimensions (n_actions in TEM config). */
export const N_ACTIONS = 16;

/** Fallback index for unrecognised events. */
export const ACTION_UNKNOWN = 0;

/**
 * Mapping of TelemetryEvent.event strings to 1-hot indices.
 * Indices are stable — do not renumber existing entries.
 */
export const ACTION_VOCAB: Record<string, number> = {
  // Graph operations (core Tractor API)
  "storage:io.storeNode": 1,
  "storage:io.queryNodes": 2,
  "storage:io.getNode": 3,

  // Plugin lifecycle
  "plugin:load": 4,
  "plugin:terminate": 5,
  "plugin:log": 6,

  // Inter-plugin API calls
  "api:call": 7,

  // Command execution
  "system:command_executed": 8,
  "system:command_failed": 9,

  // Plugin state changes
  "system:plugin_state_changed": 10,

  // Security events
  "system:security:canary_tripped": 11,

  // Identity
  "identity:guest_enabled": 12,
  "identity:connected": 13,

  // Storage tier transitions
  "system:switch-tier": 14,

  // Catch-all for storage:io and other prefixes not listed above
  "storage:io": 2,    // alias
};

/**
 * Encode a TelemetryEvent into a 1-hot action vector of shape [N_ACTIONS].
 *
 * Lookup order:
 *   1. Exact match on event.event
 *   2. Prefix match (e.g. "api:call.OutputApi" → "api:call")
 *   3. ACTION_UNKNOWN (index 0)
 */
export function encodeAction(event: { event: string }): Float32Array {
  const vec = new Float32Array(N_ACTIONS);
  const idx = resolveActionIndex(event.event);
  vec[idx] = 1.0;
  return vec;
}

/** Resolve the action index for an event string. */
export function resolveActionIndex(eventName: string): number {
  // Exact match
  if (eventName in ACTION_VOCAB) {
    return ACTION_VOCAB[eventName];
  }

  // Prefix match: "api:call.OutputApi" → "api:call"
  const parts = eventName.split(".");
  if (parts.length > 1 && parts[0] in ACTION_VOCAB) {
    return ACTION_VOCAB[parts[0]];
  }

  // Namespace prefix: "system:security:canary_tripped" already in vocab
  // but handle "system:security:*" wildcard
  const colon = eventName.lastIndexOf(":");
  if (colon > 0) {
    const ns = eventName.slice(0, colon);
    if (ns in ACTION_VOCAB) return ACTION_VOCAB[ns];
  }

  return ACTION_UNKNOWN;
}
