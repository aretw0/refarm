// heartwood is loaded dynamically inside methods to avoid premature WASM loading in tests

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
        const mod = await import("@refarm.dev/heartwood");
        const heartwood = mod.default || mod;
        // use heartwood to generate raw bytes in WASM sandbox
        const keypair = await heartwood.generateKeypair();

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
        const mod = await import("@refarm.dev/heartwood");
        const heartwood = mod.default || mod;
        const secretKey = Uint8Array.from(Buffer.from(privateKeyHex, "hex"));
        const data = typeof payload === "string" ? Buffer.from(payload) : payload;
        
        const signature = await heartwood.sign(new Uint8Array(data), secretKey);
        return Buffer.from(signature).toString("hex");
    }
}

