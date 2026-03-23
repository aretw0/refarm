#[allow(warnings)]
mod bindings;

use bindings::{Guest, Keypair, HeartwoodError};
use ed25519_dalek::{SigningKey, Verifier, VerifyingKey, Signature, Signer};
use rand_core::RngCore;
use rand_core::OsRng;

struct Sentinel;

impl Guest for Sentinel {
    fn sign(payload: Vec<u8>, secret_key: Vec<u8>) -> Result<Vec<u8>, HeartwoodError> {
        let secret_bytes: [u8; 32] = secret_key.try_into()
            .map_err(|_| HeartwoodError::InternalError("Invalid secret key length".to_string()))?;
        
        let signing_key = SigningKey::from_bytes(&secret_bytes);
        let signature = signing_key.sign(&payload);
        
        Ok(signature.to_bytes().to_vec())
    }

    fn verify(payload: Vec<u8>, signature: Vec<u8>, public_key: Vec<u8>) -> bool {
        let public_bytes: [u8; 32] = match public_key.try_into() {
            Ok(b) => b,
            Err(_) => return false,
        };
        
        let verifying_key = match VerifyingKey::from_bytes(&public_bytes) {
            Ok(k) => k,
            Err(_) => return false,
        };

        let sig = match Signature::try_from(signature.as_slice()) {
            Ok(s) => s,
            Err(_) => return false,
        };

        verifying_key.verify(&payload, &sig).is_ok()
    }

    fn generate_keypair() -> Keypair {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);
        let signing_key = SigningKey::from_bytes(&seed);
        
        Keypair {
            public_key: signing_key.verifying_key().to_bytes().to_vec(),
            secret_key: signing_key.to_bytes().to_vec(),
        }
    }
}

bindings::export!(Sentinel with_types_in bindings);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sign_verify() {
        let payload = b"hello refarm".to_vec();
        let keypair = Sentinel::generate_keypair();
        
        let signature = Sentinel::sign(payload.clone(), keypair.secret_key.clone())
            .expect("Signing failed");
            
        let is_valid = Sentinel::verify(payload, signature, keypair.public_key);
        assert!(is_valid, "Signature verification failed");
    }
}
