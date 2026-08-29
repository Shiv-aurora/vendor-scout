# TrueForge Integration

Vendor Scout uses TrueForge as the persistent agent orchestration layer and exposes the sourcing mission itself as an MCP tool surface.

The separation is intentional:

- **Vendor Scout** owns procurement state, validation, evidence, UI, and the human commitment boundary.
- **TrueForge** owns the persistent agent session, model/tool loop, external research tools, sandbox/subagents when configured, and long-running turn state.
- **MCP** is the bridge that lets the TrueForge agent read and advance the same Vendor Scout mission used by the UI/API.

## Runtime topology

```text
Vendor Scout UI
      │
      ▼
Vendor Scout Node server ───────────────┐
  mission state + validation            │ TrueForge session API
  /api/missions/...                     ▼
  /mcp  ◄───────────────────────── TrueForge
      ▲                         persistent session + turns
      │                                  │
      └──── Vendor Scout MCP connector ──┤
                                         ├─ live web/research MCPs
                                         ├─ sandbox/code execution
                                         └─ subagents when useful
```

Vendor Scout remains Node 20 compatible. Current TrueForge packages require Node 22+, so run TrueForge as its own service instead of importing its SDK into this process.

## 1. Start TrueForge

For a local TrueForge runtime, use its current CLI:

```bash
npx @truefoundry/trueforge
```

The normal local API/UI origin is:

```text
http://localhost:8790
```

A hosted TrueForge deployment may use OIDC. In that case provide its bearer/ID token to Vendor Scout through `TRUEFORGE_TOKEN`.

## 2. Configure Vendor Scout credentials

Use strong independent tokens outside local development:

```bash
export VENDOR_SCOUT_AGENT_TOKEN='<strong-random-token>'
export VENDOR_SCOUT_MCP_TOKEN='<strong-random-token>'
```

`VENDOR_SCOUT_MCP_TOKEN` is optional; when absent, Vendor Scout reuses `VENDOR_SCOUT_AGENT_TOKEN` for `/mcp`.

Do not commit either credential.

## 3. Add Vendor Scout as a TrueForge MCP connector

Create a configured MCP server in TrueForge named:

```text
vendor-scout
```

Point it at the Vendor Scout Streamable HTTP endpoint:

```text
http://localhost:3000/mcp
```

If TrueForge and Vendor Scout run on different hosts/containers, use the network-reachable Vendor Scout URL instead of `localhost`.

Configure the connector's authorization header with the same bearer value as `VENDOR_SCOUT_MCP_TOKEN`:

```text
Authorization: Bearer <VENDOR_SCOUT_MCP_TOKEN>
```

The connector exposes four tools:

| Tool | Effect |
| --- | --- |
| `vendor_scout_get_mission` | Read current persisted mission and evidence |
| `vendor_scout_discover_suppliers` | Run Vendor Scout's configured discovery provider/fallback |
| `vendor_scout_record_supplier_candidates` | Persist provenance-backed live supplier research |
| `vendor_scout_qualify_suppliers` | Persist explainable qualification decisions |

None of these tools can purchase, accept terms, or place an order.

## 4. Configure the saved TrueForge agent

Create/save an agent named:

```text
vendor-scout
```

Use the model appropriate for the hackathon environment and attach the configured `vendor-scout` MCP server.

For the current tool set, discovery and qualification are intended to run autonomously. The Vendor Scout connector can therefore be configured with no approval requirement for its current tools:

```json
{
  "name": "vendor-scout",
  "enable_tools": ["@all"],
  "disable_tools": [],
  "preload_tools": [
    "vendor_scout_get_mission",
    "vendor_scout_record_supplier_candidates",
    "vendor_scout_qualify_suppliers"
  ],
  "require_approval_for_tools": [],
  "preload": false
}
```

This is safe only because Vendor Scout currently exposes no consequential purchasing tool. When a later phase introduces `order_sample`, `accept_terms`, or another commitment tool, that tool must be explicitly configured to require human approval in TrueForge **and** remain server-side gated by Vendor Scout. Approval must not rely on prompt text alone.

Useful TrueForge runtime features for later phases:

- sandbox enabled for quote normalization / landed-cost analysis
- dynamic subagents for supplier research where they materially improve quality
- context compaction for long sourcing conversations
- external live research MCPs/tools for supplier discovery

## 5. Point Vendor Scout at TrueForge

Set:

```bash
export TRUEFORGE_BASE_URL='http://localhost:8790'
export TRUEFORGE_AGENT_NAME='vendor-scout'
export TRUEFORGE_TOKEN=''
```

Use `TRUEFORGE_TOKEN` only when the TrueForge runtime requires bearer/OIDC authentication.

Vendor Scout then supports these mission actions:

```text
connect_trueforge
start_trueforge_turn
sync_trueforge_turn
```

`connect_trueforge` creates one TrueForge session and persists its `sessionId` on the sourcing mission. Later turns reuse that session instead of creating disconnected AI requests.

`start_trueforge_turn` starts a non-streaming TrueForge turn and stores its turn ID immediately. The HTTP request does not wait for a long-running agent loop to finish.

`sync_trueforge_turn` retrieves the latest turn state and stores bounded output plus any required actions.

## 6. Preferred live discovery flow

With a live research connector/tool attached to the TrueForge agent:

```text
1. vendor_scout_get_mission
2. research real supplier sources
3. vendor_scout_record_supplier_candidates
4. vendor_scout_qualify_suppliers
5. continue toward outreach using only qualified evidence
```

The record tool requires a `sourceReference` for every supplier. If a source confirms the supplier but does not expose price, MOQ, or lead time, send those fields as `null` or omit the optional field. Vendor Scout preserves that uncertainty and marks the candidate `Needs review`; it does not fabricate a zero or favorable value.

If the TrueForge agent has no independent research tool, it can call:

```text
vendor_scout_discover_suppliers
```

That delegates discovery to `VENDOR_SCOUT_DISCOVERY_URL` when configured, otherwise to the explicitly labeled controlled fallback only when fallback is enabled.

## 7. Human approval boundary

The agent prompt explicitly forbids spending or accepting terms without approval, but the architectural control is stronger than that:

- current MCP surface does not expose a purchase/commitment tool
- Vendor Scout mission transitions contain an explicit `awaiting_approval` stage
- production mutation APIs require authentication
- later consequential tools must require TrueForge approval and Vendor Scout server validation

The final intended pattern is:

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

## 8. Production notes

For a public deployment:

- use HTTPS for remote TrueForge and discovery providers
- protect TrueForge itself with its supported OIDC/auth configuration
- configure strong Vendor Scout bearer tokens
- keep `VENDOR_SCOUT_ENABLE_DEV_RESET=0`
- keep `VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK=0` unless the demo explicitly requires it
- replace the current local JSON store with durable concurrent persistence before multi-instance production use

## Verification

Repository tests include:

- TrueForge session wire-contract tests
- TrueForge session/turn persistence through the Vendor Scout HTTP API
- MCP initialize/list/call flow
- provenance-backed live supplier ingestion
- production MCP default-deny behavior
- persisted Mission → Discover → Qualify execution
- desktop and mobile Chromium rendering in CI

A final live TrueForge validation still requires an actual configured TrueForge runtime, saved `vendor-scout` agent, and connector credentials. The repository intentionally does not fake that external evidence.
