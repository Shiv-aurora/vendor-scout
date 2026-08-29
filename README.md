# Vendor Scout

Vendor Scout is an autonomous procurement agent for hardware teams.

**Find better suppliers. Negotiate automatically. Approve the best deal.**

Built for the TrueForge Hackathon by WeMakeDevs, Vendor Scout turns one hardware need into a persistent sourcing mission. The intended full workflow is:

**Mission → Discover → Qualify → Contact → Negotiate → Compare → Human Approval → Approved Action**

## What works now

The current build has moved beyond a display-only procurement shell:

- persistent Atlas Robotics sourcing mission for 500 LiDAR modules
- complete mission policy: quantity, current supplier, target price, maximum lead time, regions, technical requirements, confidence threshold, and sample budget
- validated and persisted mission transitions
- executable supplier discovery with a remote-provider contract
- explicitly labeled controlled discovery fallback for demo reliability
- provenance-backed ingestion for supplier research performed by TrueForge or another live tool
- deterministic, explainable supplier qualification against mission constraints
- Qualified / Needs review / Rejected outcomes with evidence
- TrueForge persistent session and turn integration
- Vendor Scout MCP server exposing procurement tools to TrueForge
- production-default-deny mutation and MCP authentication boundaries
- non-destructive state migration rather than silently replacing persisted missions
- command-center UI with desktop/mobile browser validation
- explicit human-approval boundary; no purchasing tool exists yet, so the current build cannot silently cross it

Outreach, supplier email threads, autonomous negotiation, quote normalization, approval execution, and sample ordering remain later phases. They are not represented as completed behavior.

## Project state

- `docs/VISION.md` — product north star
- `docs/IMPLEMENTATION.md` — phased implementation route
- `docs/STATUS.md` — durable execution checkpoint
- `docs/TRUEFORGE.md` — TrueForge + MCP setup and architecture

## Local run

Vendor Scout itself requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

The development seed opens at the post-qualification stage so the command center is useful immediately. Use **Replay from draft** in Sourcing Missions to demonstrate the persisted `Mission → Discover → Qualify` execution path.

## Runtime configuration

Copy `.env.example` values into your runtime environment as needed. The server does not automatically load a `.env` file.

| Variable | Purpose |
| --- | --- |
| `PORT` | Vendor Scout HTTP port; defaults to `3000` |
| `VENDOR_SCOUT_DATA_PATH` | Local JSON state path |
| `VENDOR_SCOUT_AGENT_TOKEN` | Bearer token required for production mission mutations |
| `VENDOR_SCOUT_MCP_TOKEN` | Optional separate bearer token for `/mcp`; otherwise the agent token is reused |
| `VENDOR_SCOUT_DISCOVERY_URL` | Optional external supplier-discovery provider |
| `VENDOR_SCOUT_DISCOVERY_TOKEN` | Optional bearer token for that provider |
| `TRUEFORGE_BASE_URL` | TrueForge API origin, commonly `http://localhost:8790` locally |
| `TRUEFORGE_AGENT_NAME` | Saved TrueForge agent used for Vendor Scout sessions |
| `TRUEFORGE_TOKEN` | Optional bearer/OIDC token for a protected TrueForge server |
| `VENDOR_SCOUT_ALLOW_FIXTURE_FALLBACK` | Set `1` to explicitly allow controlled discovery fallback in production |
| `VENDOR_SCOUT_ENABLE_DEV_RESET` | Set `1` to explicitly expose development reset in production; normally leave disabled |

Production defaults are intentionally restrictive: development reset and fixture fallback are disabled, and mutation/MCP endpoints require configured bearer credentials.

## HTTP API

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Runtime, contract, MCP, and TrueForge readiness |
| `GET /api/capabilities` | Safe capability flags; never returns credentials |
| `GET /api/dashboard` | Command-center state and summary |
| `GET /api/missions/:id` | One sourcing mission and related evidence |
| `POST /api/missions/:id/actions` | Validated mission execution and TrueForge session/turn actions |
| `POST /api/dev/reset` | Development-only replay reset unless explicitly enabled |
| `POST /mcp` | Vendor Scout MCP JSON-RPC endpoint for TrueForge |

Current mission actions include:

- `start`
- `discover`
- `qualify`
- `connect_trueforge`
- `start_trueforge_turn`
- `sync_trueforge_turn`

## Vendor Scout MCP tools

The MCP endpoint exposes one shared implementation of the procurement workflow rather than duplicating agent logic:

- `vendor_scout_get_mission` — read current persisted mission/evidence
- `vendor_scout_discover_suppliers` — execute the configured Vendor Scout discovery path
- `vendor_scout_record_supplier_candidates` — persist supplier research performed with TrueForge/web tools; requires source provenance and accepts unknown commercial fields as `null`
- `vendor_scout_qualify_suppliers` — evaluate persisted candidates against the mission constraints

Discovery and qualification are non-destructive procurement work. No MCP tool currently spends money, accepts terms, or places an order.

## Discovery evidence

Vendor Scout supports three explicit evidence modes:

1. **TrueForge research** — a TrueForge agent uses its configured live research tools, then records evidence through `vendor_scout_record_supplier_candidates`.
2. **Remote discovery provider** — Vendor Scout calls `VENDOR_SCOUT_DISCOVERY_URL` and normalizes the returned supplier records.
3. **Controlled fixture fallback** — available in development and only in production when explicitly enabled. Fixture provenance is visibly labeled; it is never presented as live supplier research.

Supplier records require source provenance. Unknown pricing, MOQ, or lead time stays unknown and causes a `Needs review` qualification outcome rather than being invented as zero.

## TrueForge

TrueForge is kept as a separate runtime because its current packages require Node.js 22+, while Vendor Scout remains compatible with Node.js 20. Vendor Scout talks to TrueForge through its HTTP session API and exposes its own sourcing tools through MCP.

See `docs/TRUEFORGE.md` for the setup contract.

## Verification

```bash
npm test
npm run check
```

GitHub Actions additionally:

- runs all Node tests
- starts the real Vendor Scout server
- smoke-tests the runtime API
- renders the command center in headless Chrome at desktop and mobile sizes
- saves desktop/mobile screenshots and DOM output as CI artifacts

Integration tests also start mock TrueForge and Vendor Scout processes to verify persistent sessions, turns, MCP JSON-RPC, authentication boundaries, migrations, discovery, qualification, and restart persistence.

## Persistence note

The current `FileDemoStore` is intentionally lightweight for the hackathon and serializes mutations within one Vendor Scout process. It is not a substitute for a multi-instance transactional database. Before calling the service broadly production-ready, replace local JSON persistence with durable concurrent storage while keeping the same mission contract.

## Next milestone

Configure a real TrueForge runtime and its Vendor Scout MCP connector, validate a live sourcing turn with external supplier evidence, then build Phase 6 supplier outreach/RFQ persistence on top of the qualified candidate set.
