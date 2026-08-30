# TrueForge Integration

Vendor Scout uses TrueForge as the persistent agent orchestration layer and exposes the sourcing mission as an MCP tool surface.

The separation is intentional:

- **Vendor Scout** owns procurement state, validation, evidence, supplier conversations, structured offers, negotiation-gap logic, UI, and the human commitment boundary.
- **TrueForge** owns the persistent agent session, model/tool loop, external research/communication tools when configured, sandbox/subagents when useful, and long-running turn state.
- **MCP** lets TrueForge read and advance the same Vendor Scout mission used by the UI/API.

## Runtime topology

```text
Vendor Scout UI
      │
      ▼
Vendor Scout Node server ───────────────┐
  mission + supplier state              │ TrueForge session API
  RFQ + conversation state              ▼
  offer + negotiation evidence    TrueForge persistent session
  /api/missions/...               │
  /mcp  ◄─────────────────────────┤
      ▲                            ├─ live research tools
      └── Vendor Scout connector ──┤
                                   ├─ inbox/communication tools
                                   └─ sandbox/subagents
```

Vendor Scout remains Node 20 compatible. Current TrueForge packages require Node 22+, so run TrueForge as a separate service rather than importing its SDK into Vendor Scout.

## 1. Start TrueForge

```bash
npx @truefoundry/trueforge
```

The normal local API/UI origin is:

```text
http://localhost:8790
```

A hosted TrueForge deployment may use OIDC. Provide its bearer/ID token to Vendor Scout through `TRUEFORGE_TOKEN` when required.

## 2. Configure Vendor Scout credentials

```bash
export VENDOR_SCOUT_AGENT_TOKEN='<strong-random-token>'
export VENDOR_SCOUT_MCP_TOKEN='<strong-random-token>'
```

`VENDOR_SCOUT_MCP_TOKEN` is optional; when absent, Vendor Scout reuses `VENDOR_SCOUT_AGENT_TOKEN` for `/mcp`.

For real supplier communication, configure the transport described in `docs/OUTREACH.md`:

```bash
export VENDOR_SCOUT_OUTREACH_URL='https://your-outreach-adapter.example/send'
export VENDOR_SCOUT_OUTREACH_TOKEN='<provider-token>'
```

Production controlled preview is disabled unless `VENDOR_SCOUT_ALLOW_OUTREACH_PREVIEW=1` is explicitly set.

## 3. Add Vendor Scout as a TrueForge MCP connector

Create a TrueForge MCP server named:

```text
vendor-scout
```

Point it to the Vendor Scout Streamable HTTP endpoint:

```text
http://localhost:3000/mcp
```

Use a network-reachable URL when the two services run on different hosts/containers.

Configure:

```text
Authorization: Bearer <VENDOR_SCOUT_MCP_TOKEN>
```

## 4. MCP tool surface

The connector exposes **ten** tools:

| Tool | Effect |
| --- | --- |
| `vendor_scout_get_mission` | Read persisted mission, supplier evidence, RFQs, replies, structured offers, negotiation state, quotes, approvals, and activity |
| `vendor_scout_discover_suppliers` | Run Vendor Scout's configured discovery provider/fallback |
| `vendor_scout_record_supplier_candidates` | Persist provenance-backed live supplier research |
| `vendor_scout_qualify_suppliers` | Persist explainable qualification decisions |
| `vendor_scout_prepare_rfqs` | Persist non-binding RFQ conversations for qualified suppliers |
| `vendor_scout_send_rfqs` | Deliver only unsent RFQs through the idempotent transport or controlled preview |
| `vendor_scout_record_supplier_reply` | Persist one supplier response with provenance |
| `vendor_scout_record_offer_terms` | Persist explicit structured terms anchored to that recorded reply |
| `vendor_scout_prepare_counter` | Evaluate the latest offer and create one evidence-backed non-binding counter/request when needed |
| `vendor_scout_send_counter` | Deliver the prepared counter through the same retry-safe transport |

There is deliberately no acceptance, purchasing, sample-order, or other commitment tool.

## 5. Configure the saved TrueForge agent

Create/save an agent named:

```text
vendor-scout
```

Attach the `vendor-scout` MCP server. A useful configuration is:

```json
{
  "name": "vendor-scout",
  "enable_tools": ["@all"],
  "disable_tools": [],
  "preload_tools": [
    "vendor_scout_get_mission",
    "vendor_scout_record_supplier_candidates",
    "vendor_scout_qualify_suppliers",
    "vendor_scout_prepare_rfqs",
    "vendor_scout_record_offer_terms",
    "vendor_scout_prepare_counter"
  ],
  "require_approval_for_tools": [],
  "preload": false
}
```

This is safe only because the current tool surface exposes no consequential commitment action. When a later phase introduces `order_sample`, `accept_terms`, or similar, that tool must require human approval in TrueForge **and** remain server-side gated by Vendor Scout. Approval must not depend on prompt text alone.

## 6. Point Vendor Scout at TrueForge

```bash
export TRUEFORGE_BASE_URL='http://localhost:8790'
export TRUEFORGE_AGENT_NAME='vendor-scout'
export TRUEFORGE_TOKEN=''
```

Vendor Scout supports:

```text
connect_trueforge
start_trueforge_turn
sync_trueforge_turn
```

`connect_trueforge` creates one persistent TrueForge session and stores its `sessionId` on the sourcing mission.

`start_trueforge_turn` starts a non-streaming turn and stores its turn ID immediately instead of holding a Vendor Scout request open for the whole agent loop.

`sync_trueforge_turn` retrieves current turn state and stores bounded output plus required actions.

## 7. Preferred live sourcing + negotiation loop

With live research and supplier communication available:

```text
1.  vendor_scout_get_mission
2.  research real supplier sources
3.  vendor_scout_record_supplier_candidates
4.  vendor_scout_qualify_suppliers
5.  vendor_scout_prepare_rfqs
6.  vendor_scout_send_rfqs
7.  ingest supplier response with source provenance
8.  vendor_scout_record_supplier_reply
9.  vendor_scout_record_offer_terms
10. vendor_scout_prepare_counter
11. vendor_scout_send_counter when a counter exists
12. ingest revised supplier response
13. repeat steps 8–11
14. stop countering when `ready_for_comparison`
```

If Vendor Scout returns `reject_recommended` / `human_review` because the supplier explicitly failed a critical technical confirmation, stop autonomous negotiation and surface the issue.

If Vendor Scout returns `ready_for_comparison`, stop countering that supplier. This means the persisted offer has no unresolved Phase 7 negotiation gap; it does **not** accept commercial terms.

## 8. Evidence discipline

### Supplier research

Every recorded supplier requires a `sourceReference`. Unknown price, MOQ, or lead time stays `null` and remains unverified.

### Supplier replies

Every reply requires `sourceReference`, such as an email message ID/URI or webhook reference. Replaying the same provider message is idempotent.

### Structured offer terms

`vendor_scout_record_offer_terms` must reference a reply that already exists in Vendor Scout. TrueForge should record only terms the supplier explicitly stated:

- price/currency
- quantity tiers
- MOQ
- availability
- lead time
- shipping terms/cost
- sample availability/price
- certifications
- technical confirmation

Missing/uncertain terms stay null. Do not infer favorable commercial facts from prose or general supplier knowledge.

### Counters

`vendor_scout_prepare_counter` uses persisted mission constraints and persisted same-currency competitor offers. The generated message only asks for explicit improvements/missing evidence and does not disclose competitor identities.

See `docs/NEGOTIATION.md` for the full Phase 7 contract.

## 9. Outreach and negotiation safety

- RFQs and counters are explicitly non-binding.
- every outbound message has a stable idempotency key
- accepted messages are never resent
- provider acceptance is persisted
- failed delivery remains retryable
- `.example` fixture contacts cannot reach a live provider
- controlled preview persists the exact message but sends nothing external
- supplier contact/offer/counter state remains inspectable in the Conversations UI
- explicit technical incompatibility stops automated countering
- a strong offer becomes `ready_for_comparison`, not “accepted”

## 10. Human approval boundary

The architecture—not just the prompt—preserves the commitment boundary:

- current MCP surface has no purchase/acceptance tool
- mission lifecycle contains explicit `awaiting_approval`
- production mutations require authentication
- later consequential tools must require both TrueForge approval and Vendor Scout server validation

```text
research / outreach / negotiate / compare
                  │
                  ▼
          awaiting_approval
          ┌───────┼────────┐
          ▼       ▼        ▼
       approve  negotiate  reject
          │
          ▼
  approved action only
```

## 11. Production notes

For public deployment:

- use HTTPS for remote TrueForge, discovery, and outreach providers
- protect TrueForge with its supported auth/OIDC configuration
- configure strong Vendor Scout bearer tokens
- keep `VENDOR_SCOUT_ENABLE_DEV_RESET=0`
- keep `VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK=0` unless explicitly needed for a demo
- keep `VENDOR_SCOUT_ALLOW_OUTREACH_PREVIEW=0` unless deliberately desired
- replace local JSON with durable concurrent persistence before multi-instance production use

## Verification

The exact Phase 7 checkpoint passes 48/48 Node tests and dedicated browser validation. Tests cover:

- persistent TrueForge session/turn behavior
- ten-tool MCP contract and absence of commitment tools
- sourcing/discovery/qualification/outreach
- RFQ idempotency and partial-failure retries
- supplier-reply provenance
- structured-offer provenance
- price/MOQ/lead-time gap evaluation
- same-currency competitor benchmark
- stable counter messages/idempotency
- multi-round real-provider negotiation
- duplicate counter-send prevention
- ready-for-comparison stop behavior
- human-review stop on technical conflict
- desktop/mobile rendering of persisted offer, exact gaps, counter round, and preview truth state

A final real-world validation still requires an actual configured TrueForge runtime, live supplier research, live contact transport, and real supplier responses. The repository does not fake that external evidence.
