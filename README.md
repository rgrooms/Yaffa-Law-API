# Yaffa Law API

**Enterprise-grade legal operating system backend — Phase 3.5 through 7**

[![Tests](https://github.com/rgrooms/Yaffa-Law-API/actions/workflows/ci.yml/badge.svg)](https://github.com/rgrooms/Yaffa-Law-API/actions/workflows/ci.yml)

---

## Overview

The Yaffa Law API is the production backend for the Yaffa Law Legal OS demo. It provides:

- **Court Filing Simulator** — 15 Florida TPV scenarios (full lifecycle, timeouts, rejections, stamped docs)
- **BullMQ Job Queue** — durable async filing stage transitions backed by Redis
- **Socket.io** — real-time filing status push to the frontend via `/court` namespace
- **Bull Board** — admin job monitoring at `/admin/queues`
- **Provider Abstraction** — swap from Simulator to live Florida TPV with one env var
- **40 Acceptance Tests** — run in ~8.8s, no Redis or network required

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 + TypeScript |
| Framework | Express 4 |
| Database | Supabase (PostgreSQL) |
| Queue | BullMQ + IORedis |
| Real-time | Socket.io 4 |
| Testing | Vitest |
| Auth | JWT (jsonwebtoken) |
| PDF | PDFKit |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Fill in SUPABASE_URL, SUPABASE_ANON_KEY, JWT_SECRET

# 3. Start Redis
npm run redis        # Docker → Homebrew fallback

# 4. Start API
npm run dev          # http://localhost:4000

# 5. Verify
npm run health       # checks Redis + API + Bull Board
```

**Or start everything at once:**
```bash
npm run dev:full     # Redis + API + Frontend (concurrently)
```

---

## API Endpoints

### Core
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service status, worker state, active provider, socket count |
| `POST` | `/auth/login` | JWT login |
| `POST` | `/auth/register` | User registration |

### Court Filing (adapter-facing)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/court/policy` | Get court policy |
| `POST` | `/court/fees` | Calculate filing fees |
| `POST` | `/court/submit` | Submit filing (BullMQ-backed) |
| `GET` | `/court/status/:id` | Poll filing status |
| `GET` | `/court/stamped/:id` | Get stamped documents |

### Simulator (test/demo only)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/sim/scenarios` | List all 15 scenarios |
| `POST` | `/sim/filings` | Submit with scenario selection |
| `GET` | `/sim/filings/:id/status` | Poll status |
| `GET` | `/sim/filings/:id/stamped-documents` | Get stamped docs |
| `POST` | `/sim/errors/trigger` | Trigger specific error scenario |

### Admin
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/queues` | Bull Board job monitor UI |

### WebSocket
| Namespace | Event | Direction | Description |
|-----------|-------|-----------|-------------|
| `/court` | `subscribe` | Client → Server | Join `filing:{submissionId}` room |
| `/court` | `unsubscribe` | Client → Server | Leave room |
| `/court` | `court:status` | Server → Client | Filing stage update |

---

## Court Filing Scenarios

```bash
# List all 15 scenarios
curl http://localhost:4000/sim/scenarios

# Submit a valid filing
curl -X POST http://localhost:4000/sim/filings \
  -H "Content-Type: application/json" \
  -d '{"scenario": "valid", "packet": {...}}'

# Trigger a specific error
curl -X POST http://localhost:4000/sim/errors/trigger \
  -H "Content-Type: application/json" \
  -d '{"scenario": "timeout"}'
```

| Scenario | Type |
|----------|------|
| `valid` | Full lifecycle → accepted → stamped |
| `missing_signature` | Immediate rejection |
| `duplicate_filing` | Duplicate detection |
| `fee_waiver` | Indigent status |
| `multi_party` | Complex party structure |
| `court_closed` | After-hours rejection |
| `clerk_review_pending` | Extended review |
| `invalid_format` | XSD validation failure |
| `missing_lead_document` | Lead doc requirement |
| `portal_maintenance` | Scheduled downtime (503) |
| `timeout` ⭐ | Network timeout |
| `clerk_rejection` ⭐ | Clerk-initiated rejection |
| `accepted_stamped` ⭐ | Full lifecycle + stamped PDFs |
| `portal_error` | 500-level error |
| `service_list_unavailable` | E-service warning |

---

## Testing

```bash
npm test              # 40 tests, ~8.8s, no Redis needed
npm run test:watch    # watch mode
npm run test:coverage # coverage report
```

Tests run in `testMode` — Redis and Supabase are mocked. Safe to run in CI with no external dependencies.

---

## Provider Swap (Florida TPV)

The API is designed to swap from simulator to live Florida TPV with **one env var change**:

```bash
# Current (default)
COURT_PROVIDER=simulator

# After TPV certification (see FLORIDA_TPV_SWAP.md)
COURT_PROVIDER=florida_tpv
```

See [FLORIDA_TPV_SWAP.md](./FLORIDA_TPV_SWAP.md) for the full 7-step gated runbook.

---

## Scripts

```bash
npm run dev              # API server with hot reload
npm run dev:full         # Redis + API + Frontend
npm run redis            # Start Redis (Docker → Homebrew)
npm run health           # Check all services
npm run parity:simulator # Run 15 parity tests (simulator)
npm run parity:tpv       # Run 15 parity tests (florida_tpv)
```

---

## Project Structure

```
src/
├── server.ts                    # Entry point — Express + Socket.io + Bull Board
├── court/
│   ├── courtFilingProvider.ts   # Stable interface (never changes)
│   ├── courtFilingAdapter.ts    # Single import point for all court filing
│   ├── courtProviderFactory.ts  # Provider registry, lazy instantiation
│   ├── simulatorProvider.ts     # 15-scenario simulator (BullMQ + testMode)
│   ├── floridaTPVProvider.ts    # Phase 7 stub — activate after TPV cert
│   ├── floridaXmlGenerator.ts   # ECF XML generator (update at Step 2)
│   ├── parityTestHarness.ts     # 15-scenario CLI validator
│   ├── errorScenarios.ts        # Scenario registry
│   ├── stampedDocumentGenerator.ts
│   ├── feeCalculator.ts
│   ├── ecfXmlGenerator.ts
│   ├── submissionStore.ts
│   └── xsd/
│       └── florida-ecf-v3-placeholder.xsd
├── queue/
│   ├── redis.ts                 # IORedis singleton
│   ├── courtFilingQueue.ts      # BullMQ queue definition
│   └── courtFilingWorker.ts     # Stage processor + Socket.io emitter
├── routes/
│   ├── auth.ts
│   ├── cases.ts
│   ├── court.ts                 # Adapter-facing routes
│   ├── sim.ts                   # Simulator routes (test/demo)
│   └── ...
├── middleware/
│   ├── auth.ts
│   └── auditLog.ts
├── lib/
│   ├── supabase.ts
│   └── documentGenerator.ts
└── __mocks__/
    ├── ioredis.ts               # Vitest mock (no Redis in tests)
    └── queue/courtFilingQueue.ts
```

---

## Related Repos

| Repo | Description |
|------|-------------|
| [Yaffa-Law-Demo-Website](https://github.com/rgrooms/Yaffa-Law-Demo-Website) | React frontend — demo UI, auth, WebSocket client |

---

## License

Private — Yaffa Law Group. All rights reserved.
