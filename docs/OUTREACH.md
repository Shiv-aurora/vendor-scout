# Supplier Outreach

Vendor Scout's Phase 6 outreach layer turns qualified suppliers into persistent, non-binding RFQ conversations.

## Workflow

```text
qualified supplier
  → persistent RFQ draft
  → delivery attempt with idempotency key
  → externally accepted OR controlled preview / failure
  → supplier reply persisted with provenance
  → negotiation stage only after real external contact
```

## RFQ contract

Every RFQ requests:

- unit pricing for the requested quantity
- quantity-tier pricing
- MOQ
- inventory / production availability
- production lead time
- shipping terms and estimated shipping cost
- sample availability and sample pricing
- relevant certifications
- technical confirmation against the mission specification

RFQs explicitly state that they are non-binding and do not accept commercial terms or create a purchase commitment.

## Contact evidence

A supplier contact may be used only when Vendor Scout has both:

- a syntactically valid contact email
- a contact source reference

Controlled fixture contacts use reserved `.example` addresses. `lib/outreach.mjs` rejects those addresses before calling any external delivery provider, so fixture data cannot accidentally generate real outbound mail.

## Delivery transport

Configure:

```text
VENDOR_SCOUT_OUTREACH_URL
VENDOR_SCOUT_OUTREACH_TOKEN
```

Vendor Scout sends the transport a POST request containing the mission, supplier, conversation ID, and message. Every request includes:

```text
Idempotency-Key: <stable RFQ key>
```

The provider must honor this key so retries after ambiguous network failures do not duplicate an RFQ. Successful provider responses use one of:

```text
accepted
sent
delivered
```

and should return a stable provider message ID.

Production requires HTTPS for the outreach provider.

## Controlled preview

When no external provider is configured, development may use the `controlled-preview` transport. It persists the RFQ and renders it in the Conversations screen but does not send a message.

A preview:

- never counts as a contacted supplier
- never advances the mission from `contacting` to `negotiating`
- is visibly labeled `preview only`

Production preview is disabled unless `VENDOR_SCOUT_ALLOW_OUTREACH_PREVIEW=1` is explicitly set.

## Supplier replies

Replies are stored inside the supplier conversation. The write contract requires a `sourceReference` such as a mail-provider message reference. `providerMessageId` is used for idempotent replay when available.

A reply is durable evidence for later quote extraction and negotiation. The current Phase 6 implementation stores the exact reply; it does not fabricate structured quote terms.

## Approval boundary

Supplier outreach is autonomous because sending a non-binding RFQ is part of the intended agent workflow. No current outreach tool can:

- spend money
- order a sample
- accept supplier terms
- commit Atlas Robotics to a supplier

Those actions remain reserved for the later human-approval phase.
