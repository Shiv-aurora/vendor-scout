# Qodo Review Evidence

Vendor Scout is built for the TrueForge Hackathon, where substantive pull-request changes are expected to receive Qodo review before merge.

## Representative integration PR

PR #5 — `build/final-product-copy2 → main`

<https://github.com/Shiv-aurora/vendor-scout/pull/5>

PR #5 is the cumulative integration PR. It supersedes the earlier stacked PRs #2–#4 so Qodo can evaluate the complete product against `main` rather than reviewing only the final phase in isolation.

## Review history

### Initial PR #5 review

Qodo submitted a real review on 2026-08-30 and identified six material findings. None were dismissed as noise; all six were fixed and regression-tested.

The six findings were:

1. MOQ-constrained orders selected a quantity tier using requested quantity instead of actual purchased quantity.
2. Pre-shipping savings could ignore mandatory MOQ overbuy.
3. A recommendation without an orderable in-budget sample could be approved into a dead-end state.
4. The sample-order provider response limit buffered the full response before enforcing its byte cap.
5. Changed sample price/availability could bypass fresh human approval semantics.
6. A returned approval could block creation of a later pending approval cycle.

Remediation added MOQ-aware tier/savings accounting, non-executable approval enforcement, incremental response bounds, immutable approved-spend checks, and distinct approval decision cycles.

Qodo subsequently marked all six original threads resolved and its live summary reported `Bugs (0)` for that review state.

### Findings carried forward from PRs #2–#4

The earlier stacked PRs also contained Qodo findings. Before consolidating the stack, those findings were audited against the final architecture rather than mechanically dismissed.

Valid issues were fixed on the cumulative branch, including:

- failed researched-supplier ingestion advancing mission state before validation;
- MCP protocol/id-less request safety and candidate schema enforcement;
- bounded TrueForge response handling;
- explicit outreach-provider success semantics and bounded provider bodies;
- `.example.` fixture-address protection;
- supplier reply timestamp normalization and replay-safe activity;
- quantity-tier-aware negotiation pricing;
- persisted negotiation readiness when no counter is required;
- stale unsent counter invalidation when extraction/evaluation changes.

One older phase-local concern assumed foreign-currency offers had no conversion path. The final architecture intentionally allows those offers into comparison while refusing to rank them until a positive provenance-backed FX rate is supplied. That later architecture addresses the risk without forcing supplier renegotiation solely because the quote currency differs.

Focused regressions for this carried-forward review work live in `test/qodo-stack-regressions.test.mjs`.

### Fresh cumulative review against `main`

After PR #5 was retargeted to `main`, Qodo reviewed the full integrated diff and found four additional issues:

1. **Tier-price precedence — High / correctness.** Negotiation preferred standalone `unitPrice` even when an applicable quantity tier existed.
2. **Candidate schema enforcement — Medium / correctness.** Runtime MCP validation rejected unknown fields but did not fully enforce the published types/ranges of known candidate fields.
3. **Reply replay normalization — Medium / reliability.** Supplier-reply IDs hashed the untrimmed source reference while persisted provenance was trimmed.
4. **Declared oversized bodies — Medium / reliability.** The fast `Content-Length` rejection path did not cancel the unread TrueForge/outreach response body before throwing.

All four were fixed on integrated head:

`27e18af2a32d42164c8c6639e9af2453abe89969`

Remediation:

- negotiation now selects the highest applicable quantity tier first, then falls back to standalone `unitPrice`;
- MCP candidate validation now enforces required strings, nullable strings, numeric ranges/non-negativity, and three-letter currency codes before persistence;
- supplier reply provenance is normalized once before both stable-ID hashing and persistence;
- both TrueForge and outreach readers cancel the response body before throwing on an oversized declared `Content-Length`, while preserving incremental overflow cancellation.

Each of the four Qodo threads has a specific reply describing its code fix and regression evidence.

## Current validation

The integrated remediation was applied through a fail-closed GitHub Actions job that ran the complete test suite before it was permitted to commit.

Guarded workflow:

<https://github.com/Shiv-aurora/vendor-scout/actions/runs/33298301853>

Validation on the patched tree:

- `npm ci`: zero vulnerabilities
- `npm run check`: **86/86 tests passed, 0 failed**
- no temporary follow-up workflow/script/trigger files remained in the remediation commit

The added/strengthened regressions include:

- tier pricing takes precedence when both standalone and tier prices are supplied;
- invalid known MCP candidate fields are rejected before persistence;
- reply replay remains idempotent when source-reference whitespace changes;
- declared oversized TrueForge and outreach provider responses are cancelled/rejected before parsing.

The remediation commit was pushed by GitHub Actions, so the ordinary PR workflows require a subsequent user-authored checkpoint to run on the final exact head. This documentation update provides that checkpoint; the normal CI/browser workflows and a fresh Qodo follow-up must be green before merge.

## Merge gate

PR #5 remains unmerged until all of the following are true:

1. normal Vendor Scout CI plus decision/outreach/negotiation browser workflows pass on the final user-authored head;
2. Qodo re-evaluates the cumulative `main`-based PR after the four integrated fixes;
3. no valid unresolved Qodo finding remains;
4. the README points to the final reviewed PR evidence truthfully.

After #5 is clean, PRs #2–#4 should be closed as superseded by the cumulative PR rather than merged individually. PR #5 should then be merged into `main`, preserving the reviewed integration history.

Historical note: PR #1 was merged before Qodo review evidence existed. This cannot be retroactively corrected and must not be represented as reviewed.
