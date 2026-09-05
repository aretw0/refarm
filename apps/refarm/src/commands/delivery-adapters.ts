import type { DeliveryAdapterFactory } from "@refarm.dev/delivery-contract-v1";
import { telegramDeliveryAdapterFactory } from "@refarm.dev/delivery-telegram";

/**
 * The registry of delivery adapters — the ONLY file that knows which ways of
 * reaching the operator exist.
 *
 * `delivery.ts` (the canonical routing) asks for "the adapters"; it never names
 * one. A declared channel is matched to a factory by id, and everything the
 * adapter needs comes from the declaration the operator wrote. Adding a second
 * adapter is an edit HERE and a new package: no new flag, no change to routing,
 * no change to any wizard, and every existing test stays untouched.
 *
 * This is the `identity-sources.ts` precedent applied to delivery (D2), and the
 * measure of whether the seam succeeded is that the list below stays this
 * boring.
 *
 * Registering an adapter does NOT make it deliver. Nothing here reaches anyone
 * until the operator DECLARES a channel for it in `.refarm/config.json` — an
 * undeclared adapter does not exist, and refarm does not go looking for one
 * (D1). The declaration is where consent to be interrupted lives.
 */
export function defaultDeliveryAdapterFactories(): DeliveryAdapterFactory[] {
	return [telegramDeliveryAdapterFactory];
}
