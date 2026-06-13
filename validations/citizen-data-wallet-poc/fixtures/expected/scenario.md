# Citizen Data Wallet PoC Scenario

Scope: synthetic local validation only. No real personal, institutional, or secret data is used.

## Problem

A digital service needs proof of eligibility without repeatedly collecting unnecessary attributes. The scenario asks whether a local wallet flow can express purpose, scope, expiration, selective disclosure, revocation, and tamper detection as reviewable evidence.

## Actors

- Holder: synthetic citizen identity.
- Issuer: synthetic public attribute source.
- Verifier: synthetic service requesting limited attributes.
- Operator: reviews consent, revocation, and pilot readiness.

## Decision Points

1. The service request must state purpose, requested attributes, and expiration.
2. The authorization receipt must verify against its signed payload.
3. The presentation must disclose only requested attributes.
4. Revocation must make the authorization unusable.

## Outcome

The synthetic wallet had 4 available attributes, requested 2, and presented 2. Tamper verification failed as expected, and the consent decision still requires human review.
