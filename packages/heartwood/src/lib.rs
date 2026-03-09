use ed25519_dalek::{Keypair, PublicKey, SecretKey, Signer, Verifier};
use rand_core::OsRng;
use std::convert::TryFrom;

wit_bindgen::generate!({
    world: "core",
    exports: {
        world: Sentinel,
    }
});

struct Sentinel;

impl Guest for Sentinel {
    fn sign(payload: Vec<u8>, secret_key: Vec<u8>) -> Result<Vec<u8>, HeartwoodError> {
        let secret = SecretKey::from_bytes(&secret_key)
            .map_err(|_| HeartwoodError::InternalError("Invalid secret key length".to_string()))?;
        
        let public = PublicKey::from(&secret);
        let keypair = Keypair {
            secret,
            public,
        };

        let signature = keypair.sign(&payload);
        Ok(signature.to_bytes().to_vec())
    }

    fn verify(payload: Vec<u8>, signature: Vec<u8>, public_key: Vec<u8>) -> bool {
        let public = match PublicKey::from_bytes(&public_key) {
            Ok(p) => p,
            Err(_) => return false,
        };

        let sig = match ed25519_dalek::Signature::try_from(signature.as_slice()) {
            Ok(s) => s,
            Err(_) => return false,
        };

        public.verify(&payload, &sig).is_ok()
    }

    fn generate_keypair() -> Keypair {
        let mut csprng = OsRng;
        let mut secret_bytes = [0u8; 32];
        csprng.fill_bytes(&mut secret_bytes);
        
        let secret = SecretKey::from_bytes(&secret_bytes).unwrap();
        let public = PublicKey::from(&secret);

        Keypair {
            public_key: public.to_bytes().to_vec(),
            secret_key: secret.to_bytes().to_vec(),
        }
    }
}

