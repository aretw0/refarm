//! Telemetry bus — event fan-out and ring buffer.
//!
//! Mirrors `telemetry.ts` from packages/tractor/src/lib/.
//!
//! # Architecture
//! - `TelemetryBus` wraps a `tokio::sync::broadcast` channel for fan-out
//! - `RingBuffer<T>` is a `VecDeque`-backed fixed-capacity store
//! - Sensitive fields are masked before storage

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use tokio::sync::broadcast;

/// A telemetry event emitted by the host or plugins.
///
/// Mirrors `TelemetryEvent` from packages/tractor/src/lib/telemetry.ts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryEvent {
    /// Event name, e.g. "plugin:log", "api:call", "storage:io"
    pub event: String,
    /// Optional JSON payload (sensitive fields are masked)
    pub payload: Option<serde_json::Value>,
    /// Originating plugin ID (None for host events)
    pub plugin_id: Option<String>,
    /// Unix timestamp (ms)
    pub timestamp: u64,
}

impl TelemetryEvent {
    pub fn new(event: impl Into<String>, plugin_id: Option<String>) -> Self {
        Self {
            event: event.into(),
            payload: None,
            plugin_id,
            timestamp: now_ms(),
        }
    }

    pub fn with_payload(mut self, payload: serde_json::Value) -> Self {
        self.payload = Some(mask_sensitive(payload));
        self
    }
}

/// Sensitive field names — values are replaced with "[REDACTED]".
///
/// Mirrors the masking logic in packages/tractor/src/lib/telemetry.ts.
const SENSITIVE_KEYS: &[&str] = &["secret_key", "secretKey", "token", "password", "seed"];

fn mask_sensitive(mut value: serde_json::Value) -> serde_json::Value {
    if let Some(obj) = value.as_object_mut() {
        for key in SENSITIVE_KEYS {
            if obj.contains_key(*key) {
                obj.insert(key.to_string(), serde_json::Value::String("[REDACTED]".into()));
            }
        }
    }
    value
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Fixed-capacity ring buffer — oldest entries are dropped when full.
pub struct RingBuffer<T> {
    inner: VecDeque<T>,
    capacity: usize,
}

impl<T: Clone> RingBuffer<T> {
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    pub fn push(&mut self, item: T) {
        if self.inner.len() == self.capacity {
            self.inner.pop_front();
        }
        self.inner.push_back(item);
    }

    pub fn iter(&self) -> impl Iterator<Item = &T> {
        self.inner.iter()
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    pub fn to_vec(&self) -> Vec<T> {
        self.inner.iter().cloned().collect()
    }
}

/// Fan-out telemetry bus with ring buffer history.
///
/// Mirrors `TelemetryHost` from packages/tractor/src/lib/telemetry.ts.
#[derive(Clone)]
pub struct TelemetryBus {
    sender: broadcast::Sender<TelemetryEvent>,
}

impl TelemetryBus {
    pub fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self { sender }
    }

    /// Emit a telemetry event to all subscribers.
    /// Silently drops if there are no subscribers (same as EventEmitter behaviour).
    pub fn emit(&self, event: TelemetryEvent) {
        let _ = self.sender.send(event);
    }

    /// Subscribe to the telemetry stream.
    /// Returns a `broadcast::Receiver` — each call creates an independent subscription.
    pub fn subscribe(&self) -> broadcast::Receiver<TelemetryEvent> {
        self.sender.subscribe()
    }

    /// Convenience: emit a named event with an optional JSON payload.
    pub fn emit_named(
        &self,
        name: impl Into<String>,
        plugin_id: Option<String>,
        payload: Option<serde_json::Value>,
    ) {
        let mut event = TelemetryEvent::new(name, plugin_id);
        if let Some(p) = payload {
            event = event.with_payload(p);
        }
        self.emit(event);
    }
}

impl std::fmt::Debug for TelemetryBus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TelemetryBus")
            .field("receivers", &self.sender.receiver_count())
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_caps_at_capacity() {
        let mut rb = RingBuffer::new(3);
        for i in 0..5u32 {
            let event = TelemetryEvent::new(format!("event:{i}"), None);
            rb.push(event);
        }
        assert_eq!(rb.len(), 3);
        // Oldest (0, 1) should be gone; 2, 3, 4 remain
        let events: Vec<_> = rb.iter().map(|e| e.event.clone()).collect();
        assert_eq!(events, vec!["event:2", "event:3", "event:4"]);
    }

    #[test]
    fn sensitive_fields_are_masked() {
        let payload = serde_json::json!({
            "secret_key": "super-secret",
            "token": "bearer-xyz",
            "name": "visible"
        });
        let masked = mask_sensitive(payload);
        assert_eq!(masked["secret_key"], "[REDACTED]");
        assert_eq!(masked["token"], "[REDACTED]");
        assert_eq!(masked["name"], "visible");
    }

    #[tokio::test]
    async fn bus_fan_out() {
        let bus = TelemetryBus::new(100);
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();

        bus.emit_named("test:event", None, None);

        let e1 = rx1.recv().await.unwrap();
        let e2 = rx2.recv().await.unwrap();
        assert_eq!(e1.event, "test:event");
        assert_eq!(e2.event, "test:event");
    }
}
