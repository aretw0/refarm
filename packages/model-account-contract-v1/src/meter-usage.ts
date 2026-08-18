/**
 * WHICH METER A DISPATCH SPENDS — and why that has to be measured rather than tabulated.
 *
 * ISS-073 step 3. Two cheaper answers were tried first and both were measured away on 2026-08-18:
 *
 *   - the provider does NOT say per dispatch. A completion returns twelve response headers and
 *     none of them mention quota, limit, premium, usage or remaining;
 *   - a hardcoded model→meter table would age in silence, which is the failure this whole slice
 *     exists to avoid: a wrong denominator wearing a measurement's clothes.
 *
 * What is left is this node's own measurement — read the meter, dispatch once, read it again —
 * and a measurement is only worth anything with a DATE on it. An entry without `measuredAt` is
 * dropped rather than trusted, because a fact nobody can re-check is a fact nobody will.
 *
 * Measured that day: `gpt-4o` on github-copilot moved neither premium meter (1500/1500 and
 * 1706/10000 before and after). That single fact is what turns "unattributed" into a definite
 * zero for the traffic this node actually sends.
 */

export interface MeterUsageFact {
	readonly provider: string;
	readonly model: string;
	readonly meter: string;
	/** Measured: did a dispatch move this meter? */
	readonly consumes: boolean;
	/** ISO date of the measurement. Required — see the module note. */
	readonly measuredAt: string;
}

export interface MeterAttribution {
	readonly kind: "none" | "unknown";
	/** Why, in terms a reader can act on. */
	readonly because: string;
}

export interface DispatchedModel {
	readonly provider: string;
	readonly model: string;
}

/** PURE. Reads declared, dated measurements. Anything undated or malformed is dropped — the
 *  caller then sees `unknown`, which is the honest consequence of an unusable declaration. */
export function readMeterUsageFacts(config: unknown): MeterUsageFact[] {
	const declared = config && typeof config === "object" ? (config as Record<string, unknown>).modelMeters : undefined;
	if (!Array.isArray(declared)) return [];
	const facts: MeterUsageFact[] = [];
	for (const entry of declared) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
		const row = entry as Record<string, unknown>;
		if (
			typeof row.provider !== "string" ||
			typeof row.model !== "string" ||
			typeof row.meter !== "string" ||
			typeof row.consumes !== "boolean" ||
			typeof row.measuredAt !== "string" ||
			!row.measuredAt.trim()
		) {
			continue;
		}
		facts.push({
			provider: row.provider,
			model: row.model,
			meter: row.meter,
			consumes: row.consumes,
			measuredAt: row.measuredAt,
		});
	}
	return facts;
}

/**
 * PURE. How much of a meter this node's dispatches account for.
 *
 * Only two answers today, and the missing third is deliberate. `none` is claimable — every model
 * dispatched was measured not to touch this meter. A NUMBER is not: Copilot publishes per-model
 * multipliers for premium interactions, so "this model spends the meter" does not say how much,
 * and counting one dispatch as one interaction would be a rate this node invented.
 */
export function attributeMeter(
	meter: string,
	dispatched: readonly DispatchedModel[],
	facts: readonly MeterUsageFact[],
): MeterAttribution {
	if (dispatched.length === 0) {
		return { kind: "none", because: "this node dispatched nothing in that period, so it spent none of this meter." };
	}

	const unmeasured: string[] = [];
	const spenders: string[] = [];
	for (const { provider, model } of dispatched) {
		const fact = facts.find((f) => f.provider === provider && f.model === model && f.meter === meter);
		if (!fact) {
			unmeasured.push(`${provider}/${model}`);
			continue;
		}
		if (fact.consumes) spenders.push(`${provider}/${model}`);
	}

	if (unmeasured.length > 0) {
		return {
			kind: "unknown",
			because:
				`nothing has measured whether ${[...new Set(unmeasured)].join(", ")} spends \`${meter}\`. ` +
				"Read the meter, dispatch once, read it again — then declare the result with its date.",
		};
	}
	if (spenders.length > 0) {
		return {
			kind: "unknown",
			because:
				`${[...new Set(spenders)].join(", ")} was measured to spend \`${meter}\`, but not HOW MUCH — ` +
				"this provider publishes per-model multipliers, so one dispatch is not one interaction.",
		};
	}
	return {
		kind: "none",
		because: `every model dispatched was measured not to spend \`${meter}\`.`,
	};
}
