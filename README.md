# Vendor Scout

> **Find better suppliers. Negotiate automatically. Approve the best deal.**

Vendor Scout is an autonomous procurement agent for hardware teams, built for the TrueForge Hackathon by WeMakeDevs.

Give it one sourcing mission. It finds alternatives, qualifies them, starts RFQs, continues supplier conversations, negotiates against your constraints, normalizes the resulting offers, recommends the strongest deal, and stops before a consequential commitment.

```text
Mission → Discover → Qualify → Contact → Negotiate → Compare → Human Approval → Approved Action
```

The primary demo follows one concrete story: **Atlas Robotics needs 500 production LiDAR modules with better economics and a lead time under 21 days.**

## Why this matters

Hardware procurement is reactive. Teams often wait until a supplier becomes expensive, slow, unavailable, or risky before searching for alternatives, then spend days finding vendors, requesting quotes, chasing missing terms, negotiating, and comparing inconsistent offers.

Vendor Scout turns that work into an ongoing agent mission while keeping the consequential decision with a human.

## Three demo moments

### 1. The agent does procurement work, not chat

Vendor Scout carries one persistent sourcing mission through discovery, qualification, RFQ creation, supplier replies, structured offer extraction, and multi-round negotiation. Every supplier fact and supplier message retains provenance; missing commercial data stays unknown instead of becoming a convenient zero.

### 2. It negotiates, then verifies the economics

The agent counters explicit gaps in price, MOQ, lead time, technical confirmation, and missing information. Once offers are ready, TrueForge is instructed to use sandbox execution to independently check the quote math before Vendor Scout persists its deterministic comparison across quantity tiers, MOQ overbuy, FX, shipping, landed cost, lead time, supplier quality, samples, and evidence completeness.

Incomplete landed-cost offers stay visible, but cannot beat a complete landed-cost offer merely because an unknown shipping cost makes them look artificially cheap.

### 3. It cannot silently spend money

A successful comparison creates a real decision packet and moves the mission to `awaiting_approval`.

The human sees the recommendation, competing offers, current-vs-negotiated economics, landed cost, savings, lead time, MOQ, shipping, supplier risk, sample terms, reasons, risks, and source evidence.

The human chooses:

- **Approve sample**
- **Keep negotiating**
- **Reject**

Even **Approve sample** does not execute the purchase. It only records the business decision. On a later TrueForge turn, the agent may request `vendor_scout_execute_sample_order`; that MCP tool is marked destructive and configured for TrueForge tool approval, so the harness pauses again immediately before execution. Vendor Scout then independently verifies the persisted approval and sample budget before submitting the approved action.

## Architecture

```text
                                   ┌──────────────────────────────┐
                                   │      TrueForge session       │
                                   │                              │
                                   │  model / tool loop           │
                                   │  web + supplier research     │
                                   │  sandbox computation         │
                                   │  optional subagents          │
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
└───────────────────────┘              │ business approval records     │
                                       │ approved sample action        │
                                       └───────┬───────────┬───────────┘
                                               │           │
                                      outreach adapter   order adapter
```

Vendor Scout and TrueForge have intentionally different responsibilities:

- **TrueForge** is the persistent autonomous-agent runtime: model loop, MCP orchestration, research tools, sandbox computation, optional subagents, and tool approval.
- **Vendor Scout** is the procurement control plane: durable mission/evidence state, deterministic business rules, idempotency, provenance, comparison math, approval records, and server-side commitment enforcement.

The same persisted mission is used by the UI, HTTP API, and MCP tools; the demo does not maintain a separate fake “AI state.”

## TrueForge usage

Vendor Scout uses one persistent TrueForge sourcing session rather than disconnected prompt calls.

The current MCP surface exposes **12 tools**:

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

The saved TrueForge agent should enable sandbox execution and explicitly gate the final tool:

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

See [`docs/TRUEFORGE.md`](docs/TRUEFORGE.md) for the complete live-runtime setup and approval flow.

The live path was verified on 2026-08-30 with TrueForge `0.1.4`, a local Ollama tool-calling model, authenticated Vendor Scout MCP, real sandbox arithmetic, a persisted business approval, a real destructive-tool approval pause, denial without execution, and a separately allowed controlled sample action. The final action remained explicitly simulated with no external spend; exact evidence IDs are in [`docs/STATUS.md`](docs/STATUS.md).

## Procurement safety model

Vendor Scout does not rely on prompt text as its only guardrail.

### Evidence boundaries

- supplier research requires `sourceReference`
- contact information preserves its source
- supplier replies require provenance and deduplicate provider message IDs
- structured offer terms must reference an already-persisted inbound message
- unknown price / MOQ / lead time / shipping / FX remains unknown
- cross-currency analysis requires a positive FX rate with source provenance

### Outreach boundaries

- RFQs and counters are non-binding
- every outbound message has a stable idempotency key
- accepted messages are never resent
- failed delivery remains retryable
- `.example` fixture contacts are blocked from live delivery
- controlled preview sends no external message and never counts as real supplier contact

### Commitment boundaries

- quote analysis cannot accept terms or spend money
- comparison creates a pending Approval packet
- business approval does not execute the action
- sample execution requires a matching persisted human approval
- the sample-order MCP tool is explicitly destructive for the TrueForge harness gate
- sample cost must remain within the mission budget
- sample execution is idempotent across retries

## The decision packet

The Approvals screen is the climax of the product, not a decorative confirmation modal.

It shows:

- recommended supplier and decision score
- current vs negotiated unit price
- complete landed cost, or explicit incomplete-cost state
- projected savings
- current vs proposed lead time
- MOQ
- shipping terms/cost
- supplier qualification/risk
- sample availability and cost
- all supplier offers, including incomplete/unrankable evidence
- transparent scoring components
- recommendation reasons and risks
- source references

After approval, the screen explicitly distinguishes:

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

Open:

```text
http://localhost:3000
```

### Jump directly to the decision climax

With the local server running:

```bash
npm run demo:decision
```

This deterministic demo builder resets the mission, creates two controlled supplier conversation/offer records, runs the real quote engine, and leaves the mission at `awaiting_approval`.

Then open:

```text
http://localhost:3000/#app/approvals
```

The demo builder is intentionally honest: its supplier messages are labeled controlled evidence and it does not claim any real supplier was contacted.

### Run the full agent path

Start TrueForge separately:

```bash
npx @truefoundry/trueforge
```

Then follow [`docs/TRUEFORGE.md`](docs/TRUEFORGE.md) to attach the Vendor Scout Streamable HTTP MCP endpoint at `/mcp`, enable the sandbox, and configure the destructive sample-order approval gate.

## Runtime configuration

See [`.env.example`](.env.example). Important variables include:

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

Validation covers:

- sourcing mission lifecycle
- discovery and provenance
- qualification decisions
- migrations / persistence
- production default-deny behavior
- persistent TrueForge session/turn adapter
- MCP schemas and annotations
- RFQ delivery and retry/idempotency
- supplier reply provenance
- structured offer extraction
- multi-round negotiation
- stale-offer revalidation
- FX provenance
- quantity-tier and MOQ normalization
- landed cost and conservative incomplete-cost handling
- transparent quote scoring/ranking
- approval packet creation
- Approve / Keep negotiating / Reject paths
- denial of sample execution before business approval
- sample budget checks
- sample execution idempotency
- real-vs-controlled order truth
- desktop/mobile browser workflows for sourcing, conversations, negotiation, comparison, approval, and completed controlled action

`docs/STATUS.md` records the exact latest validated checkpoint and any external validation still outstanding.

## Demo reliability and truthfulness

The demo is narrow on purpose: one LiDAR sourcing mission, end to end.

External services are allowed to fail without destroying the presentation, but controlled fallbacks are never disguised as real evidence:

- controlled supplier discovery is labeled fixture evidence
- controlled RFQ/counter preview sends no email
- controlled supplier responses are labeled controlled demo messages
- controlled sample action records no external spend
- a real provider path uses the same persisted workflow with explicit provider IDs

This lets the demo remain dependable without turning the product into a sequence of fake AI screenshots.

## Hackathon scope / reused shell

Vendor Scout was built during the hackathon on top of the repository's existing lightweight hardware-dashboard/product shell. That shell supplied useful styling and hardware context; the procurement mission model, agent/MCP boundary, discovery/qualification execution, outreach, conversations, negotiation, quote engine, decision system, approval enforcement, sample-action path, tests, and hackathon-specific product framing are the hackathon implementation.

The Git history in this repository begins during the hackathon window.

## AI-assisted development disclosure

Development used OpenAI/ChatGPT-assisted engineering for implementation, debugging, review, and documentation. All generated changes were inspected against repository state and validated through the project's automated/runtime/browser checks before being treated as complete.

## Qodo Code Review Evidence

**Current status: required external review evidence is still pending.**

PR [#5](https://github.com/Shiv-aurora/vendor-scout/pull/5) has two `/agentic_review` requests and green repository checks, but the Qodo GitHub App has attached **zero submitted reviews**. Those command comments are **not** being represented as completed Qodo review evidence.

The remaining external action is to sign in to GitHub, install/authorize [Qodo Merge Pro](https://github.com/marketplace/qodo-merge-pro) for this repository, and trigger a fresh review on PR #5.

No remaining substantive implementation PR should be merged until Qodo is correctly authorized, its findings are addressed or explicitly dismissed with rationale, and follow-up review is requested where required.

Once the GitHub App is authorized, this section should link the representative final Qodo-reviewed PR and summarize the reviewed findings/fixes before submission.

## Project documentation

- [`docs/VISION.md`](docs/VISION.md) — product north star
- [`docs/IMPLEMENTATION.md`](docs/IMPLEMENTATION.md) — phased implementation route
- [`docs/STATUS.md`](docs/STATUS.md) — durable execution checkpoint
- [`docs/TRUEFORGE.md`](docs/TRUEFORGE.md) — live TrueForge/MCP/sandbox/approval setup
- [`docs/OUTREACH.md`](docs/OUTREACH.md) — RFQ transport contract
- [`docs/NEGOTIATION.md`](docs/NEGOTIATION.md) — structured offer + negotiation loop
- [`docs/QUOTES.md`](docs/QUOTES.md) — quote normalization/ranking contract
- [`docs/QODO_REVIEW.md`](docs/QODO_REVIEW.md) — Qodo review focus

## Production boundary

The hackathon build uses a single-process atomic JSON store. It is restart-persistent and deliberately fail-closed on unknown state versions, but it is not a multi-instance transactional database. A broader production deployment should replace it with durable concurrent storage without changing the procurement-domain contract.
