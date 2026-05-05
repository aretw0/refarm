/// WASI variant detection — ADR-061.
///
/// Probes the first 8 bytes of a .wasm binary to distinguish WASM modules (P1)
/// from WASM components (P2+). The probe is O(1) and allocation-free.
///
/// Binary layouts:
///   Module    (P1): 00 61 73 6d  01 00 00 00   (\0asm + version 1)
///   Component (P2): 00 61 73 6d  0d 00 01 00   (\0asm + component layer marker)
///
/// Byte 4 (0-indexed) is the "layer" discriminant:
///   0x01 → WASM module
///   0x0d → WASM component
const WASM_MAGIC: [u8; 4] = [0x00, 0x61, 0x73, 0x6d];
const MODULE_VERSION: [u8; 4] = [0x01, 0x00, 0x00, 0x00];
const COMPONENT_LAYER: u8 = 0x0d;

/// The WASI variant of a .wasm binary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WasiVariant {
    /// WASM module (WASI Preview 1 ABI — plain function exports).
    Module,
    /// WASM component (Component Model — WIT typed interfaces, P2+).
    Component,
}

impl std::fmt::Display for WasiVariant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WasiVariant::Module => write!(f, "wasm-module (WASI p1)"),
            WasiVariant::Component => write!(f, "wasm-component (WASI p2+)"),
        }
    }
}

/// Probe a byte slice (the beginning of a .wasm file) and return its variant.
///
/// Returns `None` if the magic bytes are missing or the binary is not a valid
/// WASM file.
pub fn probe_bytes(bytes: &[u8]) -> Option<WasiVariant> {
    if bytes.len() < 8 {
        return None;
    }
    if bytes[..4] != WASM_MAGIC {
        return None;
    }
    if bytes[4] == COMPONENT_LAYER {
        return Some(WasiVariant::Component);
    }
    if bytes[4..8] == MODULE_VERSION {
        return Some(WasiVariant::Module);
    }
    None
}

/// Probe a .wasm file on disk, reading only the first 8 bytes.
pub fn probe_file(path: &std::path::Path) -> anyhow::Result<WasiVariant> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)
        .map_err(|e| anyhow::anyhow!("cannot open {}: {e}", path.display()))?;
    let mut header = [0u8; 8];
    let n = f.read(&mut header)?;
    probe_bytes(&header[..n]).ok_or_else(|| {
        anyhow::anyhow!("{} is not a valid WASM module or component", path.display())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODULE_HEADER: [u8; 8] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
    const COMPONENT_HEADER: [u8; 8] = [0x00, 0x61, 0x73, 0x6d, 0x0d, 0x00, 0x01, 0x00];

    #[test]
    fn probe_identifies_wasm_module() {
        assert_eq!(probe_bytes(&MODULE_HEADER), Some(WasiVariant::Module));
    }

    #[test]
    fn probe_identifies_wasm_component() {
        assert_eq!(probe_bytes(&COMPONENT_HEADER), Some(WasiVariant::Component));
    }

    #[test]
    fn probe_rejects_non_wasm() {
        assert_eq!(probe_bytes(b"not a wasm file"), None);
    }

    #[test]
    fn probe_rejects_too_short() {
        assert_eq!(probe_bytes(&[0x00, 0x61, 0x73]), None);
    }

    #[test]
    fn probe_rejects_wrong_magic() {
        assert_eq!(
            probe_bytes(&[0x01, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
            None
        );
    }

    #[test]
    fn probe_rejects_unknown_layer_byte() {
        // valid magic, unknown layer byte — not module, not component
        assert_eq!(
            probe_bytes(&[0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]),
            None
        );
    }

    #[test]
    fn display_is_human_readable() {
        assert!(WasiVariant::Module.to_string().contains("p1"));
        assert!(WasiVariant::Component.to_string().contains("p2"));
    }

    #[test]
    fn probe_accepts_data_beyond_8_bytes() {
        let mut long = MODULE_HEADER.to_vec();
        long.extend_from_slice(&[0u8; 100]);
        assert_eq!(probe_bytes(&long), Some(WasiVariant::Module));
    }
}
