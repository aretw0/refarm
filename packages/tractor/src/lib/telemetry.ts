/**
 * @refarm.dev/tractor - Telemetry & Observability
 * 
 * Defines the core telemetry events, the event emitter, and the bounded
 * ring buffer used as Tractor's "Black Box Recorder".
 */

export interface TelemetryEvent {
  event: string;
  pluginId?: string;
  durationMs?: number;
  payload?: any;
}

export type TelemetryListener = (data: TelemetryEvent) => void;

export class EventEmitter {
  private listeners: Set<TelemetryListener> = new Set();

  on(listener: TelemetryListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(data: TelemetryEvent) {
    this.listeners.forEach((l) => l(data));
  }
}

export interface TelemetryRingBufferOptions {
  /** Maximum number of events to retain in memory. Defaults to 1000. */
  capacity?: number;
  /** Keys in payloads to mask during diagnostic export. */
  sensitiveKeys?: string[];
  /** Maximum string length for scalar values in diagnostic export. */
  maxValueLength?: number;
}

/**
 * A bounded, in-memory ring buffer for telemetry events.
 * Used for diagnostic exports without permanently storing or polluting stdout.
 */
export class TelemetryRingBuffer {
  private buffer: TelemetryEvent[];
  private capacity: number;
  private head: number = 0;
  private tail: number = 0;
  private count: number = 0;
  private sensitiveKeys: Set<string>;
  private maxValueLength: number;

  constructor(options: TelemetryRingBufferOptions = {}) {
    this.capacity = options.capacity ?? 1000;
    this.buffer = new Array(this.capacity);
    this.sensitiveKeys = new Set(options.sensitiveKeys ?? ["secretKey", "privateKey", "token", "password", "sas"]);
    this.maxValueLength = options.maxValueLength ?? 500;
  }

  /**
   * Push a new telemetry event into the ring buffer.
   * If at capacity, the oldest event is overwritten.
   */
  push(event: TelemetryEvent): void {
    if (this.capacity === 0) return;

    // We clone the event shallowly to capture a snapshot in time.
    // For payload, we also do a shallow clone to prevent immediate outer-mutation,
    // though deep mutations will still affect it unless deep cloned.
    const snapshot: TelemetryEvent = {
      event: event.event,
      pluginId: event.pluginId,
      durationMs: event.durationMs,
      payload: event.payload && typeof event.payload === 'object' ? { ...event.payload } : event.payload
    };

    this.buffer[this.head] = snapshot;
    this.head = (this.head + 1) % this.capacity;

    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.tail = (this.tail + 1) % this.capacity;
    }
  }

  /**
   * Retrieves all events in chronological order, applying sanitization
   * rules to protect sensitive data and truncate massive values.
   */
  dump(): TelemetryEvent[] {
    const result: TelemetryEvent[] = new Array(this.count);
    let current = this.tail;

    for (let i = 0; i < this.count; i++) {
      const ev = this.buffer[current];
      result[i] = {
        ...ev,
        payload: this.sanitizePayload(ev.payload)
      };
      current = (current + 1) % this.capacity;
    }

    return result;
  }

  /**
   * Masks sensitive keys and truncates long strings to ensure diagnostic
   * safety and readability.
   */
  private sanitizePayload(payload: any): any {
    if (payload == null) return payload;
    if (typeof payload !== "object") return payload;

    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(payload)) {
      if (this.sensitiveKeys.has(key)) {
        sanitized[key] = "[REDACTED]";
      } else if (typeof value === "string" && value.length > this.maxValueLength) {
        sanitized[key] = value.substring(0, this.maxValueLength) + "... [TRUNCATED]";
      } else if (value instanceof Uint8Array) {
        sanitized[key] = `[Uint8Array(${value.length})]`;
      } else if (Array.isArray(value)) {
        sanitized[key] = value.length > 50 ? `[Array(${value.length})]` : value;
      } else {
        // Deep clone not strictly required for a basic dump, but we just pass the reference
        // or apply basic masking if it were deeply nested.
        // For performance, we only sanitize the top level of the payload.
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
