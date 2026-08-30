# Qodo Review Evidence

Vendor Scout is being built for a hackathon that requires substantive pull-request changes to receive Qodo review before merge.

## Representative reviewed PR

PR #5 — `build/final-product-copy2 → build/autonomous-negotiation`

<https://github.com/Shiv-aurora/vendor-scout/pull/5>

Qodo submitted a real review on 2026-08-30 and identified six material findings. None were dismissed as noise; all six were fixed and regression-tested.

Qodo review summary:

<https://github.com/Shiv-aurora/vendor-scout/pull/5#issuecomment-5466842962>

The Qodo summary was subsequently re-evaluated against the remediation and now reports:

- `Bugs (0)`
- `Rule violations (0)`
- all six original findings marked `Resolved`

The clean remediation head is:

`e191c917f347c99e4bfd7612eca822191d38f578`

Full CI run `33294895719` passed **73/73 tests**, and the decision, outreach, and negotiation browser workflows also passed on that exact head.

## Findings and remediation

### 1. MOQ selected the wrong quantity tier — High / correctness

Qodo found that quote normalization selected the pricing tier using the requested mission quantity before computing the larger MOQ-constrained purchase quantity.

Fix:

- compute `orderQuantity` first
- select the effective quantity tier using the actual purchased quantity

Regression:

`MOQ-constrained order quantity selects the tier actually purchased`

### 2. Pre-shipping savings ignored MOQ overbuy — High / correctness

Qodo found that the fallback savings calculation subtracted price × requested quantity, even when MOQ required buying excess units.

Fix:

- compute pre-shipping savings from the MOQ-aware `itemSubtotalBase`

Regression:

`pre-shipping savings includes mandatory MOQ overbuy when shipping is unknown`

### 3. Non-sample approval could dead-end the mission — High / correctness

Qodo found that a recommendation without an orderable in-budget sample could still be approved, moving the mission to `approved` even though no executable action existed.

Fix:

- approval packets mark non-orderable actions non-executable
- domain and server reject `approve` unless the action is an in-budget `order_sample`
- UI hides `Approve sample` when no executable sample action exists
- `Keep negotiating` and `Reject` remain available

Regression:

`non-orderable recommendation cannot be approved into a dead-end state`

### 4. Sample-provider response limit buffered the whole body first — Medium / reliability

Qodo found that `response.text()` could fully allocate an unbounded chunked provider response before the nominal size check.

Fix:

- read the response stream incrementally
- count bytes as chunks arrive
- cancel immediately after crossing `MAX_RESPONSE_BYTES`
- parse only the bounded buffer

Regression:

`remote sample provider response is bounded while streaming`

### 5. Sample-price changes could bypass fresh approval — High / security

Qodo found that raw sample price/availability were not sufficiently represented in change detection, and execution could otherwise read a later mutable quote amount after a human had approved a different amount.

Fix:

- quote-analysis identity now includes material raw quote evidence, including `sample`
- the human-approved action snapshots sample spend and currency
- execution refuses quote price/currency drift with `fresh approval required`
- the submitted order uses the approved spend snapshot, not mutable quote state

Regression:

`sample execution refuses price drift after human approval`

### 6. Returned approval could block a later approval cycle — High / correctness

Qodo found that a stable approval ID could cause a `returned_to_negotiation` decision to be reused instead of creating a new pending human decision.

Fix:

- idempotency reuses only a currently `pending` matching packet
- approval records carry a decision-cycle number
- subsequent decision cycles get distinct approval IDs while preserving earlier decisions

Regression:

`keep negotiating creates a fresh approval cycle and reject never creates a sample order`

The regression verifies a second pending packet with `cycle === 2`.

## Follow-up review

After the clean remediation passed all checks, each Qodo thread received a specific response linking the implementation/test evidence.

A new `/agentic_review` request was posted on PR #5 after remediation:

<https://github.com/Shiv-aurora/vendor-scout/pull/5#issuecomment-5466942032>

Qodo acknowledged the request, and its live review summary already shows all six findings resolved with zero remaining bugs. Do not invent or claim an additional submitted Qodo review object until GitHub actually shows one.

## Merge gate

PR #5 remains intentionally unmerged.

Before merging the remaining substantive PR chain:

1. Preserve the green remediation state.
2. Confirm the follow-up Qodo run has finished on the final PR head.
3. Address any new material findings if Qodo creates them.
4. Keep the Qodo review summary and remediation evidence linked from the README.

Historical note: PR #1 was merged before Qodo review evidence existed. This cannot be retroactively corrected and must not be represented as reviewed.

## Final review focus

Any follow-up review should continue to prioritize:

- quote / landed-cost correctness
- MOQ / quantity-tier accounting
- immutable human-approved spend evidence
- approval-cycle idempotency
- sample-order provider bounds and idempotency
- production default-deny behavior
- controlled-vs-live truth boundaries
- the TrueForge destructive-tool approval boundary
