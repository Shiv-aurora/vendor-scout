# Vendor Scout

> **Find better suppliers. Negotiate automatically. Approve the best deal.**

Vendor Scout is an autonomous hardware-procurement agent built for the TrueForge Hackathon by WeMakeDevs.

Give it one sourcing mission. It finds alternatives, qualifies them, starts RFQs, continues supplier conversations, negotiates against your constraints, normalizes the resulting offers, recommends the strongest deal, and stops before consequential commitment.

```text
Mission → Discover → Qualify → Contact → Negotiate → Compare → Human Approval → TrueForge Approval → Approved Action
```

The primary demo follows one concrete story: **Atlas Robotics needs 500 production LiDAR modules with better economics and a lead time under 21 days.**

## Why this matters

Hardware procurement is reactive. Teams often wait until a supplier becomes expensive, slow, unavailable, or risky before searching for alternatives, then spend days finding vendors, requesting quotes, chasing missing terms, negotiating, and comparing inconsistent offers.

Vendor Scout turns that work into an ongoing agent mission while keeping consequential decisions with a human.

## Three demo moments

### 1. The agent does procurement work, not chat

Vendor Scout carries one persistent sourcing mission through discovery, qualification, RFQ creation, supplier replies, structured offer extraction, and multi-round negotiation. Supplier facts and messages retain provenance; missing commercial data stays unknown rather than becoming a convenient zero.

### 2. It negotiates, then verifies the economics

The agent counters explicit gaps in price, MOQ, lead time, technical confirmation, and missing information. Once offers are ready, TrueForge uses sandbox execution to independently check the quote math before Vendor Scout persists its deterministic comparison across quantity tiers, MOQ overbuy, provenance-backed FX, shipping, landed cost, lead time, supplier quality, samples, and evidence completeness.

Incomplete landed-cost offers remain visible, but cannot beat a complete landed-cost offer merely because an unknown shipping cost makes them look artificially cheap.

### 3. It cannot silently spend money

A successful comparison creates a decision packet and moves the mission to `awaiting_approval`.

The human sees the recommendation, competing offers, current-vs-negotiated economics, landed cost, savings, lead time, MOQ, shipping, supplier risk, sample terms, reasons, risks, and evidence, then chooses:

- **Approve sample**
- **Keep negotiating**
- **Reject**

Even **Approve sample** does not execute the purchase. It records the business decision. On a later TrueForge turn, the agent may request `vendor_scout_execute_sample_order`; that MCP tool is destructive and configured for TrueForge tool approval, so the harness pauses again immediately before execution. Vendor Scout then independently verifies the persisted approval, approved spend snapshot, and sample budget.

## Architecture

```text
                                   ┌──────────────────────────────┐
                                   │      TrueForge session       │
                                   │                              │
                                   │  model / tool loop           │
                                   │  MCP orchestration           │
                                   │  sandbox computation         │
                                   │  destructive-tool approval   │
                                   └──────────────┬───────────────┘
                                                  │ MCP
                                                  ▼
┌───────────────────────┐              ┌───────────────────────────────┐
│ Vendor Scout browser  │◄────────────►│ Vendor Scout Node server      │
│                       │              │                               │
│ Overview              │              │ sourcing mission state        │
│ Missions              │              │ supplier evidence             │
│ Suppliers             │              │ RFQ + conversations           │
│ Conversations         │              │ negotiation state             │
│ Approvals             │              │ quote normalization/ranking   │
└───────────────────────┘              │ approval records              │
                                       │ approved sample action        │
                                       └───────┬───────────┬───────────┘
                                               │           │
                                      outreach adapter   order adapter
```

**TrueForge** is the persistent autonomous-agent runtime: model/tool loop, MCP orchestration, sandbox computation, and tool approval.

**Vendor Scout** is the procurement control plane: durable mission/evidence state, deterministic business rules, idempotency, provenance, comparison math, approval records, and server-side commitment enforcement.

The UI, HTTP API, and MCP tools operate on the same persisted mission; there is no separate fake “AI state” for the demo.

## TrueForge usage

Vendor Scout uses one persistent TrueForge sourcing session rather than disconnected prompt calls.

The MCP surface exposes **12 tools**:

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
11. `vendor_scout_analyze_quotes`
12. `vendor_scout_execute_sample_order` — **destructive / approval-gated**

The saved TrueForge agent enables sandbox execution and gates the final tool:

```json
{
  "name": "vendor-scout",
  "enable_tools": ["@all"],
  "require_approval_for_tools": [
    "vendor_scout_execute_sample_order"
  ],
  "config": {
    "sandbox": {
      "enabled": true
    }
  }
}
```

See [`docs/TRUEFORGE.md`](docs/TRUEFORGE.md) for the live-runtime setup and approval flow.

The live path was verified on August 30, 2026 with TrueForge `0.1.4`, local Ollama `gemma4:e4b`, authenticated Vendor Scout MCP, real sandbox arithmetic, a persisted business approval, a real destructive-tool approval pause, denial without execution, and a separately allowed controlled sample action. The final action remained explicitly simulated with no external spend. Exact session/turn/tool-call evidence is in [`docs/STATUS.md`](docs/STATUS.md).

## Procurement safety model

Vendor Scout does not rely on prompt text as its only guardrail.

### Evidence boundaries

- supplier research requires `sourceReference`
- contact information preserves its source
- MCP candidate data is runtime-validated against the published contract before persistence
- supplier replies require provenance and are replay-safe after normalization
- structured offer terms must reference an already-persisted inbound message
- unknown price / MOQ / lead time / shipping / FX remains unknown
- cross-currency ranking requires a positive provenance-backed FX rate

### Outreach boundaries

- RFQs and counters are non-binding
- outbound messages use stable idempotency keys
- only explicit provider acceptance states count as real delivery
- accepted messages are never resent; failed delivery remains retryable
- `.example` and trailing-dot `.example.` fixture contacts cannot reach the live provider
- provider responses are byte-bounded while streaming and oversized declared bodies are cancelled
- controlled preview sends no external message and never counts as real supplier contact

### Commitment boundaries

- quote analysis cannot accept terms or spend money
- comparison creates a pending approval packet
- business approval does not execute the action
- non-orderable recommendations cannot be approved into a dead-end state
- sample execution requires a matching persisted human approval
- sample price/currency must still match the human-approved spend snapshot
- the sample-order MCP tool is destructive for the TrueForge harness gate
- sample cost must remain within mission budget
- execution is idempotent across retries

## Decision packet

The Approvals screen is the climax of the product, not a decorative confirmation modal. It shows:

- recommended supplier and decision score
- current vs negotiated unit price
- complete landed cost or explicit incomplete-cost state
- projected savings
- current vs proposed lead time
- MOQ and shipping
- supplier qualification/risk
- sample availability and cost
- all competing offers, including incomplete/unrankable evidence
- transparent scoring components
- recommendation reasons, risks, and source references

After approval the UI explicitly distinguishes:

1. **business approval recorded, execution still gated**
2. **TrueForge destructive-tool approval**
3. **real provider submission or controlled simulated action**

A controlled sample action is displayed as simulated and explicitly states that no external spend occurred.

## Run locally

Vendor Scout requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Startup state is selected explicitly with `VENDOR_SCOUT_SEED_MODE`. The default
is `draft`. The controlled hackathon presentation uses `approval-ready`, which
starts at a populated recommendation with a pending human decision; it does not
approve or execute a sample order.

```bash
VENDOR_SCOUT_SEED_MODE=approval-ready \
VENDOR_SCOUT_DATA_PATH=/tmp/vendor-scout-public-demo.json \
npm start
```

### Jump directly to the decision climax

With the local server running:

```bash
npm run demo:decision
```

This deterministic demo builder resets the mission, creates two controlled supplier conversation/offer records, runs the real quote engine, and leaves the mission at `awaiting_approval`.

Open `http://localhost:3000/#app/approvals`.

The demo builder is intentionally honest: its supplier messages are labeled controlled evidence and it does not claim any real supplier was contacted.

### Run the full agent path

Start TrueForge separately:

```bash
npx @truefoundry/trueforge
```

Then follow [`docs/TRUEFORGE.md`](docs/TRUEFORGE.md) to attach `/mcp`, enable sandbox execution, and configure the destructive sample-order approval gate.

## Runtime configuration

See [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `VENDOR_SCOUT_AGENT_TOKEN` | production mutation authentication |
| `VENDOR_SCOUT_MCP_TOKEN` | MCP bearer authentication |
| `VENDOR_SCOUT_DISCOVERY_URL` | optional external supplier discovery |
| `VENDOR_SCOUT_OUTREACH_URL` | optional external RFQ/counter transport |
| `VENDOR_SCOUT_ORDER_URL` | optional approved sample-order adapter |
| `TRUEFORGE_BASE_URL` | TrueForge server origin |
| `TRUEFORGE_AGENT_NAME` | saved TrueForge agent name |
| `TRUEFORGE_TOKEN` | optional hosted/OIDC token |
| `VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK` | production opt-in for controlled discovery |
| `VENDOR_SCOUT_ALLOW_OUTREACH_PREVIEW` | production opt-in for controlled outreach preview |
| `VENDOR_SCOUT_ALLOW_ORDER_PREVIEW` | production opt-in for controlled sample action |

Production defaults deny fixture fallbacks/previews and require configured bearer authentication for mutation/MCP endpoints.

## Verification

```bash
npm run check
```

The current integrated review checkpoint passes **86/86 tests** plus the dedicated decision, outreach, and negotiation browser workflows.

The verified surface includes:

- mission lifecycle, persistence, migration, and production default-deny behavior
- discovery provenance and atomic researched-supplier ingestion
- MCP protocol/request safety and runtime candidate-schema enforcement
- persistent TrueForge session/turn handling and bounded provider responses
- RFQ delivery, provider truth semantics, retry/idempotency, and fixture-address protection
- supplier reply provenance/timestamp normalization/replay safety
- evidence-anchored structured offer extraction
- multi-round negotiation, stale-counter invalidation, and quantity-tier-aware pricing
- provenance-backed FX handoff for foreign-currency offers
- quote quantity tiers, MOQ overbuy, landed cost, incomplete-cost handling, scoring/ranking
- approval packets, fresh approval cycles, and non-orderable approval denial
- approved sample price/currency drift protection
- sample budget checks, idempotency, response bounds, and real-vs-controlled truth
- desktop/mobile workflows through sourcing, negotiation, comparison, approval, and controlled completion

Latest exact-head CI evidence is recorded in [`docs/STATUS.md`](docs/STATUS.md).

## Demo reliability and truthfulness

The demo is deliberately narrow: one LiDAR sourcing mission, end to end.

External services may fail without destroying the presentation, but controlled fallbacks are never disguised as real evidence:

- controlled supplier discovery is labeled fixture evidence
- controlled RFQ/counter preview sends no email
- controlled supplier responses are labeled demo messages
- controlled sample action records no external spend
- real provider paths use the same persisted workflow with explicit provider IDs

## Hackathon scope / reused shell

Vendor Scout was built during the hackathon on top of the repository's existing lightweight hardware-dashboard/product shell. That shell supplied styling and hardware context; the procurement mission model, agent/MCP boundary, discovery/qualification execution, outreach, conversations, negotiation, quote engine, decision system, approval enforcement, sample-action path, tests, and hackathon-specific product framing are hackathon implementation.

The Git history in this repository begins during the hackathon window.

## AI-assisted development disclosure

Development used OpenAI/ChatGPT-assisted engineering and Codex for implementation, debugging, integration validation, review remediation, and documentation. Generated changes were inspected against repository state and validated through automated/runtime/browser checks before being treated as complete.

## Qodo Code Review Evidence

Representative reviewed PR: [#5 — Complete Vendor Scout: TrueForge procurement agent, approval, and sample action](https://github.com/Shiv-aurora/vendor-scout/pull/5)

PR #5 is the cumulative `main`-based integration PR. Qodo reviewed it repeatedly during remediation rather than being used as a ceremonial final check.

The first PR #5 review identified **six material quote/approval/order findings**. All six were fixed and regression-tested, including MOQ-tier accounting, MOQ-aware savings, non-orderable approvals, bounded sample-provider responses, sample-price reapproval protection, and fresh approval cycles after `Keep negotiating`.

Before consolidation, Qodo findings from stacked PRs #2–#4 were also audited and carried forward. Valid issues were fixed in MCP state atomicity/protocol safety, TrueForge response bounds, outreach delivery truth/replay behavior, and negotiation readiness/counter correctness.

After PR #5 was retargeted to `main`, Qodo reviewed the complete cumulative diff and found **four additional integrated issues**:

1. negotiation could prefer standalone price over an applicable quantity tier;
2. MCP candidate runtime validation did not fully enforce its published field constraints;
3. source-reference whitespace could defeat supplier-reply replay deduplication;
4. the declared-oversize response path did not cancel unread TrueForge/outreach bodies.

All four were fixed on `27e18af2a32d42164c8c6639e9af2453abe89969`, with focused regression coverage. The guarded remediation passed **86/86 tests** before it was allowed to commit.

Qodo's live review summary has re-evaluated the current cumulative branch and reports:

- **Bugs (0)**
- **Rule violations (0)**
- all ten PR #5 review threads **Resolved**

Review summary / evidence:

<https://github.com/Shiv-aurora/vendor-scout/pull/5#issuecomment-5466842962>

Final cumulative follow-up request:

<https://github.com/Shiv-aurora/vendor-scout/pull/5#issuecomment-5467303812>

Each material thread contains a specific remediation response and test evidence. See [`docs/QODO_REVIEW.md`](docs/QODO_REVIEW.md) for the finding-by-finding review history.

Historical note: PR #1 was merged before Qodo review evidence existed. That historical fact is not represented as reviewed work.

## Project documentation

- [`docs/VISION.md`](docs/VISION.md) — product north star
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) — phased implementation route
- [`docs/STATUS.md`](docs/STATUS.md) — durable execution checkpoint
- [`docs/TRUEFORGE.md`](docs/TRUEFORGE.md) — live TrueForge/MCP/sandbox/approval setup
- [`docs/OUTREACH.md`](docs/OUTREACH.md) — RFQ transport contract
- [`docs/NEGOTIATION.md`](docs/NEGOTIATION.md) — structured offer + negotiation loop
- [`docs/QUOTES.md`](docs/QUOTES.md) — quote normalization/ranking contract
- [`docs/QODO_REVIEW.md`](docs/QODO_REVIEW.md) — review/remediation evidence
- [`docs/DEMO.md`](docs/DEMO.md) — three-minute judge runbook

## Production boundary

The hackathon build uses a single-process atomic JSON store. It is restart-persistent and fail-closed on unknown state versions, but it is not a multi-instance transactional database. A broader production deployment should replace it with durable concurrent storage without changing the procurement-domain contract.
