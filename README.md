# Vendor Scout

Vendor Scout is a self-contained local demo for exploring hardware supply risk. It combines a dependency-light frontend, a native Node.js server, deterministic fictional data, and local JSON persistence.

This workspace has no source-control history or remote, no hosting-project link, and no third-party runtime integration. It is intended to be a safe starting point for a new product direction.

## Run locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

No credentials are required. Optional local settings can be copied from `.env.example`:

| Variable | Purpose |
| --- | --- |
| `PORT` | Local server port; defaults to `3000` |
| `VENDOR_SCOUT_DATA_PATH` | Local JSON state path; defaults to `data/runtime.json` |

## Local endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Local runtime status |
| `GET /api/dashboard` | Complete sample dashboard model |
| `GET /api/components/:id` | Component details, observations, trend, and alternatives |
| `POST /api/demo/degrade` | Introduce a deterministic sample-data issue |
| `POST /api/demo/heal` | Correct the local fixture |
| `POST /api/demo/verify` | Verify the corrected sample |
| `POST /api/demo/reset` | Restore the original local demo state |

## Project structure

- `public/` contains the landing page, dashboard, styles, and generic supply-network artwork.
- `lib/seed.mjs` contains fictional sample data.
- `lib/domain.mjs` contains risk scoring, validation, and state-transition rules.
- `lib/store.mjs` provides local file persistence only.
- `server.mjs` serves static assets and the local demo API.

## Verification

```bash
npm test
npm run check
```

Generated state is written to `data/runtime.json`, which is ignored by source control. Delete that file or use the in-app reset control to restore the seed dataset.
