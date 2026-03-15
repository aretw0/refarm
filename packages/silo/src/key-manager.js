import * as heartwood from "@refarm.dev/heartwood";

/**
 * KeyManager: Handles cryptographic identity and key storage.
 * Hardened via Heartwood (WASM).
 */
export class KeyManager {
    constructor(config = {}) {
        this.config = config;
    }

    /**
     * Generate a new Ed25519 master keypair using hardened WASM engine.
     * Returns keys as Hex strings for sovereign portability.
     */
    async generateMasterKey() {
        // use heartwood to generate raw bytes in WASM sandbox
        const keypair = heartwood.generateKeypair();

        return {
            privateKey: Buffer.from(keypair.secretKey).toString("hex"),
            publicKey: Buffer.from(keypair.publicKey).toString("hex"),
            createdAt: new Date().toISOString(),
            engine: "heartwood-wasm"
        };
    }

    async deriveChildKey(path) {
        // Stub for future HD derivation logic
        return "sk_dummy_child_key_" + path;
    }

    /**
     * Signs a message using the hardened WASM engine.
     */
    async sign(payload, privateKeyHex) {
        const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, "hex"));
        const data = typeof payload === "string" ? Buffer.from(payload) : payload;
        
        const signature = heartwood.sign(new Uint8Array(data), secretKey);
        return Buffer.from(signature).toString("hex");
    }
}

