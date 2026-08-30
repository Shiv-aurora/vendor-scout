# TrueForge Integration

Vendor Scout uses TrueForge as the persistent agent orchestration layer and exposes the procurement workflow as one authenticated MCP tool surface.

The separation is deliberate:

- **Vendor Scout** owns durable procurement state, validation, provenance, RFQs, structured offers, deterministic negotiation/comparison logic, approval records, approved-action enforcement, and the command-center UI.
- **TrueForge** owns the persistent agent session, model/tool loop, external research tools, sandbox execution, optional subagents, and the final tool-approval pause immediately before a consequential action.
- **MCP** ensures TrueForge acts on the exact same sourcing mission that the Vendor Scout UI shows.

## Runtime topology

```text
Vendor Scout UI
      │
      ▼
Vendor Scout Node server ──────────────────────┐
  mission / suppliers / conversations          │ TrueForge session API
  quotes / recommendation / approval           ▼
  approved sample action                 TrueForge persistent session
  /mcp ◄───────────────────────────────────────┤
      ▲                                        ├─ supplier/web research tools
      └──────── Vendor Scout MCP connector ────┤
                                               ├─ sandbox computation
                                               ├─ optional research subagents
                                               └─ human tool-approval gate
```

Vendor Scout stays Node 20 compatible. Current TrueForge packages require a newer Node runtime, so TrueForge runs as a separate service instead of being imported into Vendor Scout.

## 1. Start TrueForge

```bash
npx @truefoundry/trueforge
```

The normal local origin is:

```text
http://localhost:8790
```

A hosted/OIDC deployment can be used instead. Supply its ID/bearer token through `TRUEFORGE_TOKEN` when required.

## 2. Configure Vendor Scout

```bash
export VENDOR_SCOUT_AGENT_TOKEN='<strong-random-token>'
export VENDOR_SCOUT_MCP_TOKEN='<strong-random-token>'
export TRUEFORGE_BASE_URL='http://localhost:8790'
export TRUEFORGE_AGENT_NAME='vendor-scout'
```

For live supplier communication and approved sample execution, configure the optional providers documented in `.env.example`:

```bash
export VENDOR_SCOUT_OUTREACH_URL='https://your-outreach-adapter.example/send'
export VENDOR_SCOUT_OUTREACH_TOKEN='<provider-token>'
export VENDOR_SCOUT_ORDER_URL='https://your-order-adapter.example/orders'
export VENDOR_SCOUT_ORDER_TOKEN='<provider-token>'
```

Controlled preview modes are intentionally explicit. They are enabled for local development and disabled by default in production.

## 3. Add Vendor Scout as a TrueForge MCP connector

Create a Streamable HTTP MCP server named `vendor-scout` pointing to:

```text
http://localhost:3000/mcp
```

Use a network-reachable address if TrueForge and Vendor Scout run on different hosts/containers.

When a Vendor Scout MCP token is configured, send:

```text
Authorization: Bearer <VENDOR_SCOUT_MCP_TOKEN>
```

## 4. MCP tool surface

Vendor Scout exposes **12 tools**:

| Tool | Purpose | Safety |
| --- | --- | --- |
| `vendor_scout_get_mission` | Read mission, evidence, conversations, quotes, approval, orders, activity | read-only |
| `vendor_scout_discover_suppliers` | Run configured discovery/fallback | open-world, non-destructive |
| `vendor_scout_record_supplier_candidates` | Persist provenance-backed supplier research | non-destructive |
| `vendor_scout_qualify_suppliers` | Apply explainable qualification rules | non-destructive |
| `vendor_scout_prepare_rfqs` | Create durable non-binding RFQs | non-destructive |
| `vendor_scout_send_rfqs` | Deliver RFQs through retry-safe transport | open-world, non-destructive |
| `vendor_scout_record_supplier_reply` | Persist inbound supplier evidence | non-destructive |
| `vendor_scout_record_offer_terms` | Persist explicit terms anchored to a reply | non-destructive |
| `vendor_scout_prepare_counter` | Evaluate gaps and prepare a non-binding counter | non-destructive |
| `vendor_scout_send_counter` | Deliver a prepared counter | open-world, non-destructive |
| `vendor_scout_analyze_quotes` | Normalize/rank quotes and create the pending decision packet | non-destructive |
| `vendor_scout_execute_sample_order` | Execute an already human-approved sample action | **open-world + destructive + approval-gated** |

There is no generic `accept_offer`, `accept_terms`, `purchase`, or arbitrary `place_order` tool.

## 5. Saved TrueForge agent

Create/save an agent named `vendor-scout`, attach the Vendor Scout MCP connector, enable the sandbox, and explicitly require approval for the destructive sample-order tool.

Representative agent configuration:

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
    "vendor_scout_prepare_counter",
    "vendor_scout_analyze_quotes"
  ],
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

Choose any model provider configured in the TrueForge server. The critical configuration is the MCP connector, sandbox, and approval selector—not a particular model name.

TrueForge also supports annotation selectors such as `@destructive`; Vendor Scout marks the sample-order tool `destructiveHint: true`. Keeping the literal tool name in the saved-agent policy makes the demo contract obvious to judges.

## 6. Persistent session integration

Vendor Scout can create and reuse one TrueForge session per sourcing mission through:

```text
connect_trueforge
start_trueforge_turn
sync_trueforge_turn
```

`connect_trueforge` persists the returned session ID on the mission.

`start_trueforge_turn` starts a non-streaming turn and stores its turn ID immediately. Vendor Scout does not hold an HTTP request open while the agent works.

`sync_trueforge_turn` retrieves the current/terminal turn state and stores bounded output plus `requiredActions` so the product can expose a harness pause rather than hiding it.

## 7. Final autonomous sourcing loop

The intended live TrueForge flow is:

```text
1.  vendor_scout_get_mission
2.  research real supplier sources (parallel research/subagents when useful)
3.  vendor_scout_record_supplier_candidates
4.  vendor_scout_qualify_suppliers
5.  vendor_scout_prepare_rfqs
6.  vendor_scout_send_rfqs
7.  persist each real supplier reply with provenance
8.  vendor_scout_record_offer_terms
9.  vendor_scout_prepare_counter
10. vendor_scout_send_counter when needed
11. repeat replies / structured terms / counters until offers are ready
12. use TrueForge sandbox to independently check quote arithmetic
13. vendor_scout_analyze_quotes
14. STOP at `awaiting_approval` and surface the Vendor Scout decision packet
15. human chooses Approve / Keep negotiating / Reject in Vendor Scout
16. on a later TrueForge turn, an approved mission may request vendor_scout_execute_sample_order
17. TrueForge pauses on the destructive tool call
18. human allows or denies that tool call in TrueForge
19. only an allowed call reaches Vendor Scout execution
20. Vendor Scout independently verifies the persisted business approval and budget before submitting the sample action
```

This is a two-layer commitment boundary: the procurement decision is explicit in Vendor Scout, and TrueForge independently pauses the consequential tool immediately before execution.

## 8. Sandbox requirement

Quote ranking itself is deterministic inside Vendor Scout so the persisted recommendation is reproducible and testable.

For the live demo, TrueForge should also use its sandbox to recompute/check the core arithmetic from the persisted evidence before calling `vendor_scout_analyze_quotes`, including:

- effective unit price / quantity tier
- MOQ-driven overbuy
- currency conversion when a provenance-backed FX rate is available
- shipping
- landed cost
- savings versus the current supplier

The sandbox check is independent evidence that the agent is using code execution meaningfully; Vendor Scout remains the source of truth for the persisted procurement calculation.

Never fabricate missing shipping or FX inputs just to obtain a complete comparison.

## 9. Human approval semantics

A successful comparison creates a persistent `Approval` packet and moves the mission to:

```text
awaiting_approval
```

The packet includes:

- recommended supplier
- current versus negotiated unit price
- landed/known cost and completeness
- projected savings
- lead time
- MOQ
- shipping
- supplier risk / qualification evidence
- sample terms
- competing offers, including incomplete/unrankable evidence
- recommendation reasons and risks

The three business decisions are:

```text
Approve
Keep negotiating
Reject
```

`Approve` moves the mission to `approved` but **does not execute anything**. `Keep negotiating` returns the mission to negotiation. `Reject` closes the mission without a commitment.

## 10. Destructive TrueForge pause

After business approval, the agent may attempt:

```text
vendor_scout_execute_sample_order
```

That tool is annotated destructive and configured in `require_approval_for_tools`. TrueForge should therefore end the turn with an approval-required action before executing it.

The human approval decision is sent back to TrueForge as a `user.tool_approval` turn input. An allowed action proceeds; a denied action does not execute.

Vendor Scout still performs server-side checks after TrueForge approval:

- mission must be `approved`
- a matching human-approved Approval record must exist
- approved action must be `order_sample`
- quote must match the approval
- sample must be available
- sample price must remain within mission budget
- duplicate/replayed execution must return the existing order rather than spend twice

The TrueForge pause is therefore not the sole safety control.

## 11. Controlled demo versus real providers

The repository deliberately distinguishes demo reliability from external truth.

**Controlled supplier/outreach evidence** is labeled as controlled and never represented as a real supplier email.

**Controlled sample action** executes the complete approval/order state machine but returns:

```text
provider = controlled-sample-order
simulated = true
externalOrderId = null
```

No external money is spent.

With a real sample-order adapter configured, the exact same approved tool sends one idempotent request and persists the provider order ID.

## 12. Verification

Repository tests cover:

- persistent TrueForge sessions/turns
- MCP tool schemas and safety annotations
- discovery / qualification / outreach / negotiation
- supplier/offer provenance
- quote normalization and conservative landed-cost ranking
- approval-packet creation and idempotency
- rejection / keep-negotiating paths
- pre-approval execution denial
- sample budget enforcement
- sample execution idempotency
- controlled-versus-real order truth
- desktop/mobile decision UI

The final external validation still requires launching a real TrueForge runtime with a configured model, attaching the Vendor Scout MCP connector, observing sandbox execution, and visually confirming the `tool.approval_required` pause for `vendor_scout_execute_sample_order`.
