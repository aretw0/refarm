import type { BudgetResolver } from "./conformance.js";
import { resolveBudget } from "./resolve.js";

/**
 * The reference resolver for this contract. Unlike a transport-backed contract
 * (whose in-memory adapter holds state a real backend would persist), `budget:v1`
 * is PURE — `resolveBudget` already IS the reference implementation, with nothing
 * to hold. This factory exists so the package matches the house contract-v1 shape
 * (a named, swappable reference resolver `runBudgetConformance` accepts through its
 * `BudgetResolver` injection point) and so a future transport (e.g. the WASM/Rust
 * mirror of D9) has an obvious in-process baseline to diff against.
 */
export function createInMemoryBudgetResolver(): BudgetResolver {
	return resolveBudget;
}
