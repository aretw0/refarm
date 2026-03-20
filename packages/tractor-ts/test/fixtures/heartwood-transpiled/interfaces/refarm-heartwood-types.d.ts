/** @module Interface refarm:heartwood/types **/
export interface Keypair {
  publicKey: Uint8Array,
  secretKey: Uint8Array,
}
export type HeartwoodError = HeartwoodErrorInvalidSignature | HeartwoodErrorUnauthorized | HeartwoodErrorInternalError;
export interface HeartwoodErrorInvalidSignature {
  tag: 'invalid-signature',
}
export interface HeartwoodErrorUnauthorized {
  tag: 'unauthorized',
}
export interface HeartwoodErrorInternalError {
  tag: 'internal-error',
  val: string,
}
