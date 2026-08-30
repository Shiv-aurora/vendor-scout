# Quote Comparison Contract

Phase 8 converts negotiation-ready supplier offers into deterministic, auditable quote records and one human-approval-required recommendation. It does not accept supplier terms, place an order, or create approval decisions.

## Phase boundary

Input:

```text
persisted supplier reply
→ structured offer terms
→ current negotiation evaluation = ready_for_comparison
```

Output:

```text
normalized quote records
→ explicit completeness / FX / landed-cost state
→ transparent component scores
→ ranked eligible offers
→ recommendation requiring human approval
```

If the current set of competing offers makes a previously ready supplier no longer competitive against the Phase 7 counter benchmark, Phase 8 re-evaluates that supplier before ranking and moves the stale conversation back to negotiation.

## Normalized quote record

Each quote preserves:

- supplier and conversation IDs
- source offer ID / inbound message / source reference
- original and base currency
- explicit FX rate and FX source provenance when currencies differ
- requested quantity
- effective order quantity after MOQ
- excess/overbuy units caused by MOQ
- effective unit price and quantity-tier basis
- item subtotal
- shipping terms and explicitly stated shipping cost
- known normalized total
- complete landed cost only when shipping and FX are known
- lead time
- MOQ
- sample availability / price
- certifications
- technical confirmation
- supplier-confidence / technical-match evidence
- completeness flags and missing fields
- savings versus the current supplier unit-cost baseline
- transparent score components and final rank

## Quantity tiers and MOQ

For the mission quantity, Vendor Scout selects the highest applicable quoted quantity tier. If MOQ exceeds the mission quantity, order quantity becomes the MOQ and excess units are recorded explicitly.

MOQ overbuy is never hidden by calculating cost only for the requested quantity.

## Shipping and landed cost

Missing shipping cost is not converted to zero.

Vendor Scout distinguishes:

- `knownTotal` — item subtotal plus any explicitly known shipping cost
- `landedCost.complete=false` — shipping or FX is incomplete
- complete landed cost — only when all required cost inputs are explicit

A recommendation based on incomplete landed cost is marked provisional and exposes the missing fields as risks.

## FX provenance

Mission base currency is the current supplier currency.

Same-currency quotes use an identity rate. Cross-currency quotes require an explicitly supplied positive `rateToBase` with `sourceReference` provenance. Example:

```json
{
  "currency": "EUR",
  "rateToBase": 1.16,
  "sourceReference": "fx/ecb/2026-08-29",
  "asOf": "2026-08-29"
}
```

Without the FX source, base-currency price and landed cost remain unknown and the quote cannot be fabricated into a ranked recommendation.

## Current-offer revalidation

Phase 8 does not trust an old `offer_ready` flag blindly. Before ranking it re-runs Phase 7 `evaluateOffer` for every latest supplier offer against the **current** competitor set.

This matters because a supplier at USD 388 may have been ready when alone, but if another supplier later reaches USD 382, the USD 388 offer now has a current price gap and should return to negotiation rather than appear in the final ranking.

The fresh evaluation is synced back into the persisted conversation state.

## Scoring

The current transparent score uses these weights:

| Component | Weight |
| --- | ---: |
| Economics | 40% |
| Lead time | 20% |
| Supplier quality | 15% |
| MOQ fit | 10% |
| Sample terms | 5% |
| Evidence completeness | 10% |

Every quote stores both component scores and weights. There is no hidden LLM ranking score.

Economics is based on normalized known cost relative to the best eligible known cost. Lead-time score uses the mission ceiling. Supplier-quality score derives from persisted supplier confidence and technical match. MOQ and sample scores use mission constraints. Completeness penalizes missing evidence.

## Conservative comparability rule

When at least one eligible offer has a complete landed cost, only complete-landed-cost offers receive a final rank. Offers with unknown shipping remain visible with `comparison.basis = incomplete-landed-cost`, but cannot win by appearing artificially cheaper.

If every otherwise-eligible offer lacks landed-cost inputs, Vendor Scout may produce a clearly `provisional` recommendation using known normalized cost. The missing fields remain attached as recommendation risks.

## Recommendation

The top eligible quote produces one recommendation containing:

- supplier / quote ID
- score
- evidence-backed reasons
- explicit risks / missing fields
- `humanApprovalRequired: true`
- `commitmentExecuted: false`

A complete quote may be `recommended`. An incomplete but otherwise eligible quote is `provisional`.

If no current-ready quote has enough normalized price/FX and technical evidence, Vendor Scout returns blockers and does not fabricate a recommendation.

## Persistence and idempotency

Re-analysis replaces the mission's previous normalized quote set and recommendation instead of appending duplicates.

The analysis signature excludes timestamp-only changes. Re-running identical analysis therefore does not create a fake new comparison event.

When a material offer/FX/cost/ranking input changes, the signature changes and Vendor Scout records a new comparison activity event.

## MCP / HTTP

MCP:

```text
vendor_scout_analyze_quotes
```

Input:

```json
{
  "missionId": "mission-lidar-500",
  "fxRates": []
}
```

HTTP:

```text
POST /api/missions/:missionId/analysis
```

Body:

```json
{
  "fxRates": []
}
```

Both routes use the same deterministic quote engine and persisted mission state.

## Human commitment boundary

Phase 8 may:

- normalize offers
- calculate costs/savings
- score/rank offers
- recommend one supplier
- prepare data for Phase 9 human approval

Phase 8 may **not**:

- accept an offer
- accept terms
- spend money
- order a sample
- place a purchase order
- create a fake human approval decision

The MCP tool surface intentionally contains no acceptance or purchasing tool.
