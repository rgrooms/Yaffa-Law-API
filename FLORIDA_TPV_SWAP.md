# Florida TPV Credentialed API Swap Plan

**Yaffa Law OS — Phase 7 Runbook**  
*Last updated: May 2026*

---

> [!IMPORTANT]
> This runbook is **the only authorized procedure** for transitioning from the Court Filing Simulator to the live Florida TPV API. No step may be skipped. Each step has a defined gate condition.

---

## Prerequisites

Before starting this plan, you need:

| Item | Source | Status |
|------|--------|--------|
| Florida Courts E-Filing Authority TPV application approved | [FCEFA Portal](https://www.floridacourts.org) | ⏳ Pending |
| $500 TPV application fee paid and confirmed | FCEFA | ⏳ Pending |
| Official Florida XSD schemas received | FCEFA (post-approval) | ⏳ Pending |
| Florida TPV Sandbox credentials | FCEFA (post-approval) | ⏳ Pending |
| Attorney sign-off for first live sandbox submission | Samuel Yaffa | ⏳ Pending |

---

## The 7 Steps

### Step 1 — Replace XSD Schemas with Official FCEFA Definitions

**Gate condition:** Official XSD files received from FCEFA

```bash
# Place official schemas here:
src/court/xsd/
├── florida-ecf-v3-placeholder.xsd    ← DELETE this
├── florida-ecf-v3-filing.xsd         ← ADD (official)
├── florida-ecf-v3-case.xsd           ← ADD (official)
├── florida-ecf-v3-documents.xsd      ← ADD (official)
├── florida-ecf-v3-fees.xsd           ← ADD (official)
└── florida-ecf-v3-response.xsd       ← ADD (official)
```

**Files to update after schemas received:**
- `src/court/xsd/` — add official schemas, delete placeholder
- `src/court/floridaXmlGenerator.ts` — update namespace URIs and element names
- `src/court/floridaTPVProvider.ts` — wire `validateAgainstFloridaXSD()` to real schemas

**Verification:**
```bash
# Validate a test XML against the new schema
npx tsx -e "
  import { generateFloridaECFXml } from './src/court/floridaXmlGenerator';
  import { validateAgainstFloridaXSD } from './src/court/floridaXmlGenerator';
  // ... generate and validate
"
```

---

### Step 2 — Build `floridaXmlGenerator.ts` Against Certified Schemas

**Gate condition:** Step 1 complete, schemas validated locally

Update `src/court/floridaXmlGenerator.ts`:

1. Replace `xmlns="urn:florida:courts:ecf:v3:simulator"` with the certified FCEFA namespace
2. Update all element names to match the official XSD definitions
3. Implement `validateAgainstFloridaXSD()` using `libxmljs2`:

```bash
npm install libxmljs2 @types/libxmljs2
```

4. Add a unit test:

```bash
npm test -- --reporter=verbose src/court/__tests__/floridaXmlGenerator.test.ts
```

---

### Step 3 — Implement `FloridaTPVProvider`

**Gate condition:** Step 2 complete + FCEFA Sandbox credentials in hand

1. Open `src/court/floridaTPVProvider.ts`
2. Implement each method (the TODO blocks are pre-written — fill them in)
3. Set credentials in `.env` (never commit real credentials):

```bash
# .env (local)
FLORIDA_TPV_API_URL=https://sandbox.efilingapi.flcourts.org/api/v1
FLORIDA_TPV_API_KEY=your-sandbox-api-key
FLORIDA_TPV_CLIENT_ID=your-client-id
FLORIDA_TPV_CLIENT_SECRET=your-client-secret
COURT_PROVIDER=florida_tpv
```

4. Verify the provider initializes without error:

```bash
npm run dev
# Look for: [CourtProviderFactory] Active provider: FloridaTPVProvider
```

---

### Step 4 — Run Parity Tests Against Sandbox

**Gate condition:** Step 3 complete + sandbox responding

Run all 15 scenarios against the simulator first (baseline):

```bash
npm run parity:simulator
# Expected: 15/15 passed
```

Then run against the Florida TPV sandbox:

```bash
npm run parity:tpv
# Required: 15/15 passed before proceeding
```

The parity harness generates a JSON report. Save it:

```bash
# Reports saved as: parity-report-florida_tpv-{timestamp}.json
# Review all terminal statuses match the simulator behavior
```

> [!CAUTION]
> **Do NOT proceed to Step 5 if any parity test fails.** Each failure represents a behavioral difference between the simulator and the real Florida portal. All 15 must pass.

---

### Step 5 — Switch `COURT_PROVIDER=florida_tpv` in Staging

**Gate condition:** Step 4 — all 15 parity tests passing

Update staging environment:

```bash
# .env.staging
NODE_ENV=staging
COURT_PROVIDER=florida_tpv
FLORIDA_TPV_API_URL=https://sandbox.efilingapi.flcourts.org/api/v1
# ... all credentials
```

Deploy to staging. Verify health check:

```bash
npm run health
# Expected:
#   ✓ Redis       → localhost:6379 (PONG)
#   ✓ API         → http://localhost:4000/health (worker: running)
#   ✓ Bull Board  → http://localhost:4000/admin/queues

curl http://staging-api/health | jq .provider
# Expected: "florida_tpv"
```

Run the demo end-to-end on staging. Submit a test filing via the UI:
- Select scenario: ✅ Valid Filing — Accepted
- Verify the filing goes through the real Florida sandbox (not the simulator)
- Verify stamped documents are returned

---

### Step 6 — Attorney Sign-Off

**Gate condition:** Step 5 complete + staging passing

Samuel Yaffa (or designated attorney) must review:

- [ ] One complete successful filing through the Florida TPV sandbox
- [ ] Stamped documents returned correctly
- [ ] Rejection scenarios handled correctly (clerk rejection, missing signature)
- [ ] Fee calculation matches Florida's official schedule
- [ ] Sign sign-off form before production deployment

---

### Step 7 — Enable in Production

**Gate condition:** Step 6 attorney sign-off obtained

1. Update production `.env`:

```bash
COURT_PROVIDER=florida_tpv
FLORIDA_TPV_API_URL=https://efilingapi.flcourts.org/api/v1   # ← Production URL
```

2. Deploy production build
3. Verify health check shows `"provider": "florida_tpv"`
4. Monitor Bull Board (`/admin/queues`) for first 24 hours
5. Monitor Supabase `system_events` table for any `event_type = 'failure'` entries

> [!WARNING]
> Keep `COURT_PROVIDER=simulator` available as an instant rollback. If production shows issues, revert `.env` and restart — no code deployment needed.

---

## Rollback Procedure

At any step, rollback is a one-line config change:

```bash
# .env (or .env.staging)
COURT_PROVIDER=simulator
```

Restart the API server. The simulator takes over immediately. No data is lost — all submissions in the `submissionsStore` / Supabase `jobs` table persist across provider switches.

---

## Key Files

| File | Purpose |
|------|---------|
| `src/court/courtFilingProvider.ts` | Stable interface — **never changes** |
| `src/court/courtFilingAdapter.ts` | Entry point — routes to active provider |
| `src/court/courtProviderFactory.ts` | Provider registry + lazy instantiation |
| `src/court/simulatorProvider.ts` | Simulator implementation (always available) |
| `src/court/floridaTPVProvider.ts` | TPV implementation (activate at Step 3) |
| `src/court/floridaXmlGenerator.ts` | ECF XML generation (update at Step 2) |
| `src/court/xsd/` | XSD schemas (replace at Step 1) |
| `src/court/parityTestHarness.ts` | 15-scenario parity validation (run at Step 4) |
| `.env.example` | All env variables documented |

---

## Contact

**Florida Courts E-Filing Authority (FCEFA)**  
TPV Program  
Website: https://www.floridacourts.org  
Phone: (850) 922-5081  

*Reference: Florida Courts E-Filing Authority TPV Application (2021 edition)*
