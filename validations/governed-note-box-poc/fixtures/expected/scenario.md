# Governed Note Box PoC Scenario

Scope: synthetic local validation only. No real vault, work draft, personal data, institutional data, or secrets are used.

## Problem

A local knowledge base needs to preserve provenance and publish only reviewed material without turning the vault workflow into hidden automation. The scenario asks whether notes can move from intake to lab and publication snapshots with metadata, review gates, and explicit publication limits.

## Actors

- Author: creates synthetic notes.
- Curator: reviews metadata and publication readiness.
- Lab consumer: uses graph and metrics snapshots.
- Publication consumer: receives only reviewed note metadata.

## Decision Points

1. Every note must keep title, tags, links, status, date, and body hash.
2. Draft notes must be excluded from publication output.
3. The lab snapshot must expose graph and metric evidence.
4. Publication must remain blocked on human review.

## Outcome

The synthetic run ingested 3 notes, kept 1 draft out of publication, and produced 2 publication candidates. Human review remains required before publishing.
