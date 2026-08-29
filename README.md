# Vendor Scout

Vendor Scout is an autonomous procurement agent for hardware teams.

**Find better suppliers. Negotiate automatically. Approve the best deal.**

The product is being built for the TrueForge Hackathon by WeMakeDevs. Its end state is a persistent sourcing agent that discovers supplier alternatives, qualifies them, handles RFQ and negotiation work, normalizes the resulting offers, and stops for human approval before a consequential commercial action.

## Current implementation

The repository started as a local hardware supply-risk demo. That shell is now being converted in place rather than replaced.

The current foundation includes:

- the Atlas Robotics 500-unit LiDAR sourcing mission
- mission constraints for price, lead time, region, technical fit, confidence, and sample budget
- structured supplier candidates with provenance and qualification decisions
- procurement navigation: Overview, Sourcing Missions, Suppliers, Conversations, Approvals
- an explicit mission lifecycle and approval boundary
- local JSON persistence for development
- Node.js tests for lifecycle, approval gating, seed integrity, savings calculations, and persistence

The current seed intentionally stops at **supplier qualification**. Outreach, supplier conversations, negotiation, quotes, approval execution, and sample ordering are not presented as completed behavior until those integrations exist.

See:

- `docs/VISION.md` — product north star
- `docs/IMPLEMENTATION.md` — phased implementation route
- `docs/STATUS.md` — current execution checkpoint

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Optional local settings can be copied from `.env.example`:

| Variable | Purpose |
| --- | --- |
| `PORT` | Local server port; defaults to `3000` |
| `VENDOR_SCOUT_DATA_PATH` | Local JSON state path; defaults to `data/runtime.json` |

## Current endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Runtime status |
| `GET /api/dashboard` | Procurement command-center state and summary |
| `GET /api/missions/:id` | One sourcing mission with related suppliers, conversations, quotes, approvals, and activity |
| `POST /api/dev/reset` | Reset local development state to the current procurement seed |

## Verification

```bash
npm test
npm run check
```

CI also smoke-tests the running server and dashboard contract when GitHub Actions is available.

## Next milestone

Replace the deterministic discovery/qualification fixture with executable supplier discovery and qualification, then connect the persistent mission to TrueForge as the workflow orchestrator before adding supplier outreach and negotiation.
