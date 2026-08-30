# Vendor Scout

Vendor Scout is an autonomous procurement agent for hardware teams.

**Find better suppliers. Negotiate automatically. Approve the best deal.**

Built for the TrueForge Hackathon by WeMakeDevs, Vendor Scout turns one hardware need into a persistent sourcing mission:

**Mission → Discover → Qualify → Contact → Negotiate → Compare → Human Approval → Approved Action**

## What works now

The current build executes the workflow through autonomous negotiation:

- persistent Atlas Robotics sourcing mission for 500 LiDAR modules
- complete mission policy: quantity, current supplier, target price, maximum lead time, allowed regions, technical requirements, confidence threshold, and sample budget
- validated and persisted mission transitions
- executable supplier discovery with a remote-provider contract
- explicitly labeled controlled discovery fallback for demo reliability
- provenance-backed ingestion for supplier research performed by TrueForge or another live tool
- deterministic, explainable supplier qualification against mission constraints
- Qualified / Needs review / Rejected outcomes with evidence
- persistent one-thread-per-qualified-supplier RFQ conversations
- non-binding RFQ generation requesting pricing tiers, MOQ, availability, lead time, shipping, samples, certifications, and technical confirmation
- idempotent outbound transport with provider message IDs and retry-safe delivery
- controlled outreach preview that sends no external message and does not claim real supplier contact
- provenance-required supplier replies
- structured supplier-offer terms anchored to recorded inbound messages
- explicit negotiation-gap evaluation for price, MOQ, lead time, technical confirmation, and missing commercial evidence
- goal-directed non-binding counter generation using mission constraints and stronger same-currency persisted competitor offers when available
- multi-round counter delivery through the same idempotent supplier transport
- automatic stop when an offer is ready for downstream comparison
- automatic stop for human judgment on an explicit critical technical conflict
- TrueForge persistent session and turn integration
- Vendor Scout MCP server exposing ten sourcing/outreach/negotiation tools
- production-default-deny mutation and MCP authentication boundaries
- non-destructive state migration; current state contract `2.3.0`
- command-center Conversations UI showing RFQ evidence, supplier replies, structured offers, exact negotiation gaps, counter rounds, and delivery truth
- explicit human-approval boundary; no acceptance, purchase, or order tool exists

Phase 8 quote normalization/landed-cost ranking, approval execution, and sample ordering are not implemented yet and are not presented as completed behavior.

## Project docs

- `docs/VISION.md` — product north star
- `docs/IMPLEMENTATION.md` — phased implementation route
- `docs/STATUS.md` — durable execution checkpoint
- `docs/TRUEFORGE.md` — TrueForge + MCP setup and architecture
- `docs/OUTREACH.md` — RFQ transport, idempotency, preview, and reply contract
- `docs/NEGOTIATION.md` — structured offers, gap evaluation, counter loop, and Phase 7/8 boundary

## Local run

Vendor Scout requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The development seed opens after qualification so the command center is useful immediately. Use **Replay from draft** in Sourcing Missions to demonstrate persisted `Mission → Discover → Qualify`. Conversations can prepare and preview RFQs without contacting a real supplier when no external transport is configured.

## Runtime configuration

The server does not automatically load a `.env` file. Use `.env.example` as the environment-variable reference.

| Variable | Purpose |
| --- | --- |
| `PORT` | Vendor Scout HTTP port; defaults to `3000` |
| `VENDOR_SCOUT_DATA_PATH` | Local JSON state path |
| `VENDOR_SCOUT_AGENT_TOKEN` | Bearer token required for production mission mutations |
| `VENDOR_SCOUT_MCP_TOKEN` | Optional separate bearer token for `/mcp`; otherwise agent token is reused |
| `VENDOR_SCOUT_DISCOVERY_URL` | Optional external supplier-discovery provider |
| `VENDOR_SCOUT_DISCOVERY_TOKEN` | Optional bearer token for discovery |
| `VENDOR_SCOUT_OUTREACH_URL` | Optional external RFQ/counter transport |
| `VENDOR_SCOUT_OUTREACH_TOKEN` | Optional bearer token for outreach transport |
| `TRUEFORGE_BASE_URL` | TrueForge API origin, commonly `http://localhost:8790` locally |
| `TRUEFORGE_AGENT_NAME` | Saved TrueForge agent used for Vendor Scout sessions |
| `TRUEFORGE_TOKEN` | Optional bearer/OIDC token for protected TrueForge |
| `VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK` | Explicitly allow controlled discovery fallback in production |
| `VENDOR_SCOUT_ALLOW_OUTREACH_PREVIEW` | Explicitly allow simulated RFQ/counter preview in production |
| `VENDOR_SCOUT_ENABLE_DEV_RESET` | Explicitly expose development reset in production |

Production defaults are restrictive: development reset, fixture discovery fallback, and controlled outreach/counter preview are disabled, while mutation/MCP endpoints require configured bearer credentials.

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Runtime, contract, MCP, and TrueForge readiness |
| `GET /api/capabilities` | Safe capability flags; never returns credentials |
| `GET /api/dashboard` | Command-center state and summary |
| `GET /api/missions/:id` | One sourcing mission and related evidence/conversations |
| `POST /api/missions/:id/actions` | Validated mission execution, outreach, and TrueForge actions |
| `POST /api/missions/:id/suppliers/:supplierId/reply` | Persist one provenance-backed supplier reply |
| `POST /api/missions/:id/suppliers/:supplierId/offer` | Persist structured terms anchored to that supplier reply |
| `POST /api/missions/:id/suppliers/:supplierId/counter` | Prepare or send one evidence-backed negotiation counter |
| `POST /api/dev/reset` | Development-only replay reset unless explicitly enabled |
| `POST /mcp` | Vendor Scout MCP JSON-RPC endpoint for TrueForge |

Current mission actions include `start`, `discover`, `qualify`, `prepare_outreach`, `send_outreach`, `connect_trueforge`, `start_trueforge_turn`, and `sync_trueforge_turn`.

RFQ and counter delivery are retry-safe: messages have stable idempotency keys, accepted messages are not resent, and failed delivery remains retryable.

## Vendor Scout MCP tools

The MCP endpoint exposes the same persisted workflow used by the UI/API:

1. `vendor_scout_get_mission`
2. `vendor_scout_discover_suppliers`
3. `vendor_scout_record_supplier_candidates`
4. `vendor_scout_qualify_suppliers`
5. `vendor_scout_prepare_rfqs`
6. `vendor_scout_send_rfqs`
7. `vendor_scout_record_supplier_reply`
8. `vendor_scout_record_offer_terms`
9. `vendor_scout_prepare_counter`
10. `vendor_scout_send_counter`

The negotiation tools are intentionally narrow. Offer terms must reference an existing inbound supplier message. Counter preparation is deterministic from persisted evidence. Counter sending is non-binding and idempotent. There is deliberately no `accept_offer`, `accept_terms`, `purchase`, `place_order`, or equivalent commitment tool.

## Negotiation evidence model

Negotiation preserves this chain:

```text
supplier source/message
        ↓
persisted inbound reply
        ↓
structured explicit offer terms
        ↓
constraint-gap evaluation
        ↓
non-binding counter/request
        ↓
provider delivery state
```

Unknown offer fields stay unknown. Vendor Scout does not invent a price, MOQ, lead time, shipping term, sample term, certification, or technical confirmation.

The evaluator returns:

- `needs_information` — required facts are still missing
- `counter_required` — an explicit commercial/lead-time gap exists
- `ready_for_comparison` — no unresolved negotiation gap remains; **this does not accept the offer**
- `reject_recommended` — explicit critical technical conflict; autonomous countering stops for human judgment

See `docs/NEGOTIATION.md` for the full contract.

## Discovery and outreach truth boundaries

Supplier records require provenance. Unknown pricing, MOQ, or lead time causes review rather than being invented as zero.

For outreach:

- **Controlled preview:** persists the exact RFQ/counter, sends nothing external, and never increments real-contact metrics.
- **External transport:** sends only to a non-demo contact through `VENDOR_SCOUT_OUTREACH_URL`, includes `Idempotency-Key`, and records provider acceptance/message ID.
- `.example` fixture contacts are blocked from a real provider.
- supplier replies require `sourceReference` and are deduplicated.

## TrueForge

TrueForge stays a separate runtime because its current packages require Node.js 22+, while Vendor Scout remains Node 20 compatible. Vendor Scout talks to TrueForge through its HTTP session API and exposes the ten procurement tools through MCP.

The TrueForge prompt now describes the complete persisted loop:

```text
read mission
→ research / record candidates
→ qualify
→ prepare / send RFQ
→ record supplier reply
→ record explicit offer terms
→ prepare / send counter
→ repeat until ready for comparison or human review
```

See `docs/TRUEFORGE.md` for setup details.

## Verification

```bash
npm test
npm run check
```

The exact Phase 7 checkpoint passes **48/48 tests** on Node 20.20.2. Coverage includes:

- discovery/qualification/migrations
- production auth/default-deny behavior
- TrueForge session/turn persistence
- ten-tool MCP contract and safety annotations
- RFQ construction/delivery/idempotency
- partial outreach retry after negotiation begins
- supplier-reply provenance/deduplication
- structured-offer provenance
- price/MOQ/lead-time gap evaluation
- stronger same-currency competitor benchmark
- stable counter IDs/idempotency keys
- multi-round real-provider negotiation
- duplicate counter-send prevention
- stop-for-comparison behavior
- stop-for-human technical-conflict behavior

GitHub Actions additionally runs desktop/mobile Chromium validation. The dedicated negotiation workflow constructs controlled negotiation evidence, persists an offer, prepares/previews a counter, verifies the exact gaps in state, renders `#app/conversations`, and saves screenshot/DOM artifacts.

## Persistence note

`FileDemoStore` is intentionally lightweight for the hackathon and serializes mutations within one Vendor Scout process. It is not a multi-instance transactional database. Durable concurrent storage remains required before broad production use.

## Next milestone

Phase 8 will normalize finalized supplier offers into comparable quote records, calculate landed-cost economics, rank offers, and produce an evidence-backed recommendation. It must still stop before acceptance or purchase and route the recommendation into the human approval boundary.
