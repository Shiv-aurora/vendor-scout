# Autonomous Negotiation Contract

Phase 7 turns supplier replies into a persistent, evidence-backed negotiation loop. It does **not** accept commercial terms, rank final quotes, or place an order.

## Evidence chain

Every negotiation decision must retain this chain:

```text
supplier message source
        ↓
persisted inbound reply
        ↓
structured offer terms
        ↓
constraint-gap evaluation
        ↓
non-binding counter/request
        ↓
provider delivery state
```

Vendor Scout rejects structured offer terms that cannot be tied to an existing inbound supplier message by `sourceReference` or `sourceMessageId`.

## Structured offer terms

TrueForge may interpret a supplier reply, but Vendor Scout only stores explicit terms supplied through `vendor_scout_record_offer_terms`:

- unit price
- currency
- quantity tiers
- MOQ
- availability
- production lead time
- shipping terms
- shipping cost when explicitly stated
- sample availability
- sample price
- certifications
- technical confirmation
- bounded notes

Unknown terms stay `null` or empty. They are never inferred as zero or treated as favorable.

The persisted offer lives inside the supplier conversation rather than the Phase 8 normalized quote model:

```text
conversation.negotiation.offers[]
conversation.negotiation.latestEvaluation
conversation.negotiation.counterRounds
```

That keeps Phase 7 focused on negotiation evidence while Phase 8 remains responsible for normalized landed-cost comparison and ranking.

## Gap evaluation

`prepareCounter` evaluates the latest offer against the mission and returns one of four outcomes:

| Outcome | Meaning |
| --- | --- |
| `needs_information` | No hard gap is known, but required commercial/technical evidence is still missing |
| `counter_required` | One or more explicit price, MOQ, or lead-time gaps exist |
| `ready_for_comparison` | No unresolved negotiation gap remains; proceed to Phase 8 without accepting the offer |
| `reject_recommended` | The supplier explicitly failed critical technical confirmation; stop autonomous countering for human judgment |

Current explicit comparisons include:

- same-currency unit price versus the mission target
- same-currency competing persisted offers when they provide a stronger benchmark
- MOQ versus requested mission quantity
- lead time versus mission maximum
- technical confirmation
- presence of shipping terms
- presence of sample availability / sample price when relevant

Competitor supplier identities are not disclosed in the generated counter.

## Counter generation

Counters are generated only from persisted gaps/missing fields. Examples:

- improve price to the mission or stronger same-currency benchmark
- reduce MOQ to the requested production quantity or lower
- meet the mission lead-time ceiling
- provide missing pricing, MOQ, lead time, shipping, sample, or technical confirmation

Every generated counter explicitly states that it is non-binding and does not accept commercial terms or create a purchase commitment.

A counter is stable for the same supplier offer:

```text
conversation + offer + negotiation round
        ↓
stable message ID
stable Idempotency-Key
```

Calling prepare repeatedly for the same offer does not append duplicate counter messages.

## Delivery and retries

`vendor_scout_send_counter` uses the same outreach transport as RFQs:

```text
VENDOR_SCOUT_OUTREACH_URL
VENDOR_SCOUT_OUTREACH_TOKEN
```

Rules:

- real provider delivery includes the persisted `Idempotency-Key`
- accepted counter messages are never resent
- controlled preview persists the exact counter but sends no external message
- delivery failure remains retryable
- a later supplier reply creates a new evidence source and therefore a new offer/counter round

## Multi-round loop

```text
supplier reply
    ↓
record explicit offer terms
    ↓
prepare counter
    ├─ ready_for_comparison → stop countering; hand to Phase 8
    ├─ reject_recommended   → stop for human judgment
    └─ counter draft
           ↓
       send counter
           ↓
       supplier reply
           ↓
       record revised terms
           ↓
       repeat
```

The mission remains in `negotiating` when an offer becomes `ready_for_comparison`. This is deliberate: Phase 7 does not silently skip into the Phase 8 quote-comparison implementation before that model exists.

Vendor Scout exposes `mission.execution.negotiationReady=true` once a persisted offer is ready for downstream comparison.

## MCP tools added in Phase 7

The Vendor Scout MCP surface now includes:

- `vendor_scout_record_offer_terms`
- `vendor_scout_prepare_counter`
- `vendor_scout_send_counter`

Alongside the seven sourcing/outreach tools from prior phases, the complete surface has ten tools.

There is intentionally **no** `accept_offer`, `accept_terms`, `purchase`, `place_order`, or sample-order commitment tool.

## HTTP endpoints

For non-MCP integrations:

```text
POST /api/missions/:missionId/suppliers/:supplierId/offer
POST /api/missions/:missionId/suppliers/:supplierId/counter
```

Counter request body:

```json
{ "action": "prepare" }
```

or:

```json
{ "action": "send" }
```

Production mutations use the same Vendor Scout bearer-auth boundary as other mission actions.

## Verification

Tests cover:

- offer provenance must match a persisted inbound reply
- missing fields remain unknown
- price/MOQ/lead-time gap calculation
- stronger same-currency competitor benchmark
- stable counter IDs and idempotency keys
- no counter when an offer is ready for comparison
- stop-for-human behavior on explicit technical incompatibility
- complete multi-round real-provider flow
- duplicate counter-send prevention
- controlled counter preview
- MCP safety annotations and absence of commitment tools
- browser rendering of persisted offer, exact gaps, counter round, and preview truth state
