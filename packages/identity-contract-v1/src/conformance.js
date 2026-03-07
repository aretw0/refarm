import { IDENTITY_CAPABILITY, } from "./types.js";
export async function runIdentityV1Conformance(provider) {
    const failures = [];
    if (provider.capability !== IDENTITY_CAPABILITY) {
        failures.push("provider.capability must be 'identity:v1'");
    }
    if (!provider.pluginId || provider.pluginId.trim().length === 0) {
        failures.push("provider.pluginId must be a non-empty string");
    }
    let identityId = null;
    try {
        const identity = await provider.create("Conformance Test");
        identityId = identity.id;
        if (!identityId) {
            failures.push("create() must return identity with id");
        }
        if (!identity.publicKey) {
            failures.push("create() must return identity with publicKey");
        }
    }
    catch (error) {
        failures.push(`create() threw: ${String(error)}`);
    }
    if (identityId) {
        const testData = "hello refarm";
        try {
            const sigResult = await provider.sign(identityId, testData);
            if (!sigResult.signature) {
                failures.push("sign() must return signature");
            }
            if (!sigResult.algorithm) {
                failures.push("sign() must return algorithm");
            }
            try {
                const verifyResult = await provider.verify(sigResult.signature, testData);
                if (!verifyResult.valid) {
                    failures.push("verify() must return valid=true for correct signature");
                }
            }
            catch (error) {
                failures.push(`verify() threw: ${String(error)}`);
            }
        }
        catch (error) {
            failures.push(`sign() threw: ${String(error)}`);
        }
        try {
            const fetched = await provider.get(identityId);
            if (!fetched) {
                failures.push("get() must return created identity");
            }
        }
        catch (error) {
            failures.push(`get() threw: ${String(error)}`);
        }
    }
    const failed = failures.length;
    return {
        pass: failed === 0,
        total: 7,
        failed,
        failures,
    };
}
//# sourceMappingURL=conformance.js.map