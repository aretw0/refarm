#[allow(warnings)]
mod bindings;

use std::cell::RefCell;

use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use sha2::{Digest, Sha256};

use bindings::exports::plugin::host::identity_provider::Guest as IdentityGuest;
use bindings::exports::plugin::host::integration::{
    Guest as IntegrationGuest, PluginMetadata,
};
use bindings::plugin::host::types::PluginError;

/// The reference sovereign identity provider.
///
/// It proves the one guarantee the TS `HeartwoodIdentityProvider` cannot make:
/// **the private key never leaves the WASM sandbox.** The TS provider keeps
/// `secretKeyHex` in JS memory and passes it back into the crypto core on every
/// `sign` — the key crosses the boundary. Here the [`SigningKey`] is born inside
/// the module, lives in module-local state, and is exported by NO function.
/// `sign` takes only the payload; `public-key` returns only the public half.
///
/// The guarantee has two layers. (1) The API shape: no exported function returns
/// key material — unconditional, holds however the component is instantiated.
/// (2) The import surface: the `identity-plugin` world's only plugin-host import
/// is `tractor-bridge` — no `host-fs`/`host-net`/`model-bridge`, so a signer has
/// no data channel to a keystore or the network. (The standard `wasm32-wasip1`
/// runtime-adapter WASI imports are present as in every Rust component here; the
/// host wires them to a denied table.)
struct SovereignIdentity;

// The one identity this provider manages, held module-local. `None` until the
// first `sign`/`public-key` (lazy auto-seed) or an explicit `derive-from-session`.
//
// This is the sovereign vault: the bytes of `SigningKey` sit here and are only
// ever consumed by `.sign()` / `.verifying_key()` — never serialized out.
thread_local! {
    static KEY: RefCell<Option<SigningKey>> = const { RefCell::new(None) };
}

/// Derive an Ed25519 signing key deterministically from a caller-supplied seed.
///
/// OPAQUE unlock path: after the host completes an OPAQUE AKE handshake it hands
/// the resulting session-key to `derive-from-session`; we stretch it to 32 bytes
/// with SHA-256 and unlock the identity inside the sandbox. The host receives an
/// opaque handle, never the key.
fn signing_key_from_seed(seed: &[u8]) -> SigningKey {
    let mut hasher = Sha256::new();
    hasher.update(b"refarm:identity-provider-ref:v1");
    hasher.update(seed);
    let digest = hasher.finalize();
    let bytes: [u8; 32] = digest.into();
    SigningKey::from_bytes(&bytes)
}

/// Ensure `KEY` holds a signing key, auto-seeding from a fixed marker on first
/// use so `sign`/`public-key` work even before an explicit `derive-from-session`.
/// The marker seed is deterministic — a demo can reproduce the public key — but
/// a real deployment always drives `derive-from-session` with a live session key.
fn ensure_key<R>(f: impl FnOnce(&SigningKey) -> R) -> R {
    KEY.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            *slot = Some(signing_key_from_seed(b"auto-seed"));
        }
        f(slot.as_ref().expect("seeded above"))
    })
}

impl IdentityGuest for SovereignIdentity {
    /// Sign a payload with the managed key. Note the signature: NO key argument.
    /// The key is read from module-local state and never returned.
    fn sign(payload: Vec<u8>) -> Result<Vec<u8>, PluginError> {
        Ok(ensure_key(|key| key.sign(&payload).to_bytes().to_vec()))
    }

    /// Verify a signature against an externally supplied public key. Pure — no
    /// managed key touched; a host can verify any peer's signature here.
    fn verify(payload: Vec<u8>, sig: Vec<u8>, pubkey: Vec<u8>) -> Result<bool, PluginError> {
        let pub_bytes: [u8; 32] = pubkey
            .try_into()
            .map_err(|_| PluginError::InvalidSchema("public key must be 32 bytes".to_string()))?;
        let verifying = VerifyingKey::from_bytes(&pub_bytes)
            .map_err(|e| PluginError::InvalidSchema(format!("invalid public key: {e}")))?;
        let signature = Signature::try_from(sig.as_slice())
            .map_err(|e| PluginError::InvalidSchema(format!("invalid signature: {e}")))?;
        Ok(verifying.verify(&payload, &signature).is_ok())
    }

    /// Return the public key of the managed identity. This is the ONLY key
    /// material that ever crosses the boundary — the public half, by design.
    fn public_key() -> Result<Vec<u8>, PluginError> {
        Ok(ensure_key(|key| key.verifying_key().to_bytes().to_vec()))
    }

    /// Unlock (or re-derive) the managed identity from an externally produced
    /// session key, storing it module-local. Returns an opaque handle — the host
    /// can then call `sign`/`public-key` but cannot extract the private key.
    fn derive_from_session(session_key: Vec<u8>) -> Result<u64, PluginError> {
        if session_key.is_empty() {
            return Err(PluginError::InvalidSchema(
                "session key must not be empty".to_string(),
            ));
        }
        let key = signing_key_from_seed(&session_key);
        // The handle is a non-secret fingerprint of the public key — stable for a
        // given session key, opaque to the caller, and carries no private bytes.
        let pubkey = key.verifying_key().to_bytes();
        let handle = u64::from_le_bytes(pubkey[..8].try_into().expect("32 >= 8"));
        KEY.with(|cell| *cell.borrow_mut() = Some(key));
        Ok(handle)
    }
}

impl IntegrationGuest for SovereignIdentity {
    fn setup() -> Result<(), PluginError> {
        Ok(())
    }
    fn ingest() -> Result<u32, PluginError> {
        Ok(0)
    }
    fn push(_payload: String) -> Result<(), PluginError> {
        Ok(())
    }
    fn teardown() {}
    fn get_help_nodes() -> Result<Vec<String>, PluginError> {
        Ok(vec![])
    }
    fn metadata() -> PluginMetadata {
        PluginMetadata {
            name: "identity-provider-ref".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            description:
                "Sovereign Ed25519 identity: the private key is generated and held inside the WASM sandbox and never crosses the boundary."
                    .to_string(),
            supported_types: vec!["Identity".to_string()],
            required_capabilities: vec!["tractor-bridge".to_string()],
        }
    }
    fn on_event(_event: String, _payload: Option<String>) {}
    fn respond(_payload: String) -> Result<String, PluginError> {
        Err(PluginError::NotPermitted(
            "identity-provider-ref signs; it does not respond".to_string(),
        ))
    }
}

bindings::export!(SovereignIdentity with_types_in bindings);

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
