# EnrichFlow — Product Flow & Testing Guide

EnrichFlow is a GoHighLevel (GHL) marketplace app that **enriches contacts**. Given a sparse
contact (a name + company, or just an email), it fills in work email, phone, job title, LinkedIn,
and firmographics using a **provider waterfall** (cheap primary → premium fallback).

**Billing is hybrid:** a **mandatory monthly subscription** (collected by GHL) that includes a
pool of credits each month, plus **usage-based credits** for any overage beyond the included pool.
Credits are tiered by what was actually found.

This document explains the end-to-end product flow and gives **copy-paste steps to test every piece**,
from a pure-local logic test (no GHL, no keys) all the way to a full OAuth + billing + workflow run.

---

## 1. Components

```
enrichflow/
├── enrichflow-api/      # Node/Express backend (OAuth, enrichment, billing, workflow action, APIs)
│   └── src/
│       ├── server.js                  # app + route mounting + serves UI at /app
│       ├── config/database.js         # Mongo (REQUIRED — process exits if it can't connect)
│       ├── services/
│       │   ├── ghlService.js          # GHL OAuth + contact read/write/search
│       │   ├── subscriptionService.js # mandatory monthly plan: entitlement + included-credit pool
│       │   ├── billingService.js      # overage credits -> GHL wallet charge (gated by BILLING_ENABLED)
│       │   └── enrichRunner.js        # shared run: gate -> enrich -> write-back -> plan/overage -> persist
│       ├── enrichment/
│       │   ├── fields.js              # canonical fields + tiered-credit accounting
│       │   ├── enrichmentService.js   # provider waterfall + merge
│       │   └── providers/             # mock | prospeo | pdl
│       ├── routes/
│       │   ├── oauth.js               # /oauth/authorize, /oauth/callback, /oauth/status
│       │   ├── webhooks.js            # /api/webhooks/enrichflow (INSTALL/UNINSTALL)
│       │   ├── enrich.js              # /api/enrich, /api/enrich/preview
│       │   ├── workflow.js            # /api/workflow/enrich/execute (custom workflow action)
│       │   ├── contacts.js            # /api/contacts (UI bulk picker)
│       │   ├── subscription.js        # /api/subscription/status (+ dev-activate)
│       │   └── analytics.js           # /api/analytics/usage (UI dashboard)
│       └── models/                    # OAuthToken, Installation, Subscription, EnrichmentRecord
│
└── enrichflow-ui/       # Vite + React Custom Page (embedded as iframe in GHL)
    └── src/
        ├── App.jsx                    # shell, locationId resolution, connect banner, tabs
        ├── api.js                     # API client (same-origin / dev proxy)
        └── components/                # SingleEnrich, BulkEnrich, UsageDashboard, EnrichResult
```

---

## 2. End-to-end flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│ 1. INSTALL  (mandatory subscription)                                         │
│    Agency/sub-account installs EnrichFlow from the GHL Marketplace and pays  │
│    the recurring plan fee (GHL collects it — the app has a subscription      │
│    price). GHL only completes INSTALL after payment.                         │
│    GHL → /oauth/callback with a code → we exchange it → store tokens.        │
│    GHL → /api/webhooks/enrichflow (INSTALL) → store Installation +           │
│          ACTIVATE Subscription (monthly included-credit pool starts).        │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 2. ENRICH  (3 entry points, all share enrichRunner.runEnrichment)            │
│    a) Custom Page UI  → POST /api/enrich        (manual / bulk)              │
│    b) Workflow action → POST /api/workflow/enrich/execute  (automation)      │
│    c) Direct API      → POST /api/enrich        (integrations)               │
│                                                                              │
│    runEnrichment:                                                            │
│      GATE: require an entitled subscription (402 if not) ──────────┐         │
│      fetch contact from GHL  →  provider waterfall (primary → fallback)      │
│      →  merge results        →  compute credits (tiered)                     │
│      →  write fields back to the GHL contact                                 │
│      →  consume monthly INCLUDED credits first (free within the plan)        │
│      →  charge agency wallet ONLY for the OVERAGE (if BILLING_ENABLED)       │
│      →  persist EnrichmentRecord (audit + usage dashboard)                   │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 3. OBSERVE                                                                   │
│    Custom Page → /api/analytics/usage → runs, matches, credits, est. spend.  │
└────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ 4. UNINSTALL                                                                 │
│    GHL → /api/webhooks/enrichflow (UNINSTALL) → mark uninstalled, drop tokens│
└────────────────────────────────────────────────────────────────────────────┘
```

### Pricing model (mandatory subscription + usage overage)

**Monthly plan** (env: `PLAN_NAME`, `PLAN_PRICE_USD`, `PLAN_INCLUDED_CREDITS`) — e.g. *Starter,
$29/mo, 300 included credits*. Mandatory: a location must have an entitled subscription to enrich.
The recurring fee is collected by GHL (set the subscription price on the app in the dashboard).

**Credits** (what each enrichment consumes, computed from the final merged result):

| Data found | Credits |
|---|---|
| Basic (company / title / linkedin / location / industry / domain / size) | 1 |
| + verified work email | +1 |
| + verified phone / mobile | +5 |

A full match (basic + email + phone) = **7 credits**. Each run consumes the monthly **included**
pool first (free within the plan); only the **overage** is billed to the wallet at
`CREDIT_PRICE_USD` (default $0.05/credit). So a $29 plan with 300 credits ≈ 42 full enrichments/mo
included, then ~$0.35 per additional full match.

---

## 3. Testing — start here (no GHL, no API keys)

### 3.1 Pure-local enrichment logic (no DB needed)

```bash
cd enrichflow-api
npm install
cp .env.example .env        # defaults are fine
npm run enrich:local
```

Expected: the waterfall + tiered-credit accounting prints for several sample contacts
(full match = 7 credits, no-phone case, no-match = 0 credits, company-only). This mock test runs
entirely in-process and does **not** require MongoDB.

### 3.2 API over HTTP — "local mode" (no GHL)

A MongoDB connection is **required** to boot the server — set `MONGODB_URI` in `.env` (local
`mongod` or an Atlas SRV string) first, or the process exits.

```bash
npm run dev                  # http://localhost:3010
curl http://localhost:3010/health   # -> { ..., "db": "connected" }
```

```bash
# Preview (dry run — no charge, no write-back)
curl -s -X POST http://localhost:3010/api/enrich/preview \
  -H 'Content-Type: application/json' \
  -d '{"input":{"email":"jane.doe@acme.io","fullName":"Jane Doe","company":"Acme"}}' | jq

# Full run in local mode (no contactId -> no GHL calls; billing is a no-op)
curl -s -X POST http://localhost:3010/api/enrich \
  -H 'Content-Type: application/json' \
  -d '{"input":{"fullName":"Sam Patel","companyDomain":"stripe.com"}}' | jq
```

The full run returns a `billing` block. With `BILLING_ENABLED=false` it shows
`{ charged:false, skipped:"billing_disabled", amount:0.35, credits:7 }` — i.e. what *would* be charged.

### 3.3 Custom Page UI (local dev)

```bash
cd ../enrichflow-ui
npm install
npm run dev                  # http://localhost:5173  (proxies /api + /oauth to :3010)
```

Open http://localhost:5173. Without a connected location you can still use **By details → Preview**.
Click "Set location" in the header to enter a test `locationId` (or load the page with
`?locationId=<id>`, which is how GHL injects it into the iframe).

---

## 4. Testing — full GHL integration (OAuth + DB)

GHL must redirect to a public HTTPS URL, so expose the local API with a tunnel.

```bash
# terminal 1: mongo (or use Atlas)
mongod --dbpath /tmp/enrichflow-db

# terminal 2: tunnel
cloudflared tunnel --url http://localhost:3010
#   -> https://<sub>.trycloudflare.com
```

### 4.1 Configure the marketplace app

At https://marketplace.gohighlevel.com create/edit the app and set:

- **Redirect URI**: `https://<tunnel>/oauth/callback`
- **Webhook URL**: `https://<tunnel>/api/webhooks/enrichflow`
- **Scopes**: `contacts.readonly contacts.write locations.readonly users.readonly oauth.readonly`
- **Custom Page URL** (iframe): `https://<tunnel>/app` (after you build the UI — see 4.5)
- **Workflow action** execution webhook: `https://<tunnel>/api/workflow/enrich/execute`
- **Subscription price** (mandatory monthly plan): set a recurring price on the app so GHL collects
  the fee at install. Mirror it in `.env` (`PLAN_PRICE_USD`, `PLAN_INCLUDED_CREDITS`).

Then fill `enrichflow-api/.env`:

```env
MONGODB_URI=mongodb://localhost:27017/enrichflow
GHL_CLIENT_ID=...
GHL_CLIENT_SECRET=...
GHL_APP_ID=...
GHL_REDIRECT_URI=https://<tunnel>/oauth/callback
```

Restart `npm run dev`. The health check should now show `"db":"connected"`.

### 4.2 Install + verify the round-trip

1. Visit `https://<tunnel>/oauth/authorize` (or install from the marketplace) and pick a sub-account.
2. You should land on the "EnrichFlow connected ✅" page.
3. Check status:

```bash
curl -s "https://<tunnel>/oauth/status?locationId=<LOCATION_ID>" | jq
# -> { "success": true, "connected": true }
```

### 4.3 Enrich a real contact (write-back)

```bash
curl -s -X POST https://<tunnel>/api/enrich \
  -H 'Content-Type: application/json' \
  -d '{"locationId":"<LOCATION_ID>","contactId":"<CONTACT_ID>","writeBack":true}' | jq
```

Expected: `matched:true`, a `data` object, `writtenToGhl:true`, and a `billing` block. Open the
contact in GHL — email/phone/company and the `enrichflow_*` custom fields should be populated.

> Custom fields: create these in the sub-account (or let GHL auto-create on write) —
> `enrichflow_job_title`, `enrichflow_linkedin_url`, `enrichflow_industry`,
> `enrichflow_company_domain`, `enrichflow_company_size`, `enrichflow_location`.

### 4.4 Workflow action ("Enrich Contact")

1. In a sub-account, build a workflow with a trigger (e.g. "Contact Created").
2. Add the **EnrichFlow → Enrich Contact** action.
3. Enroll a contact (or use "Test workflow"). GHL POSTs to `/api/workflow/enrich/execute` with the
   location + contact context; EnrichFlow enriches, writes back, and charges.

Simulate the call locally:

```bash
curl -s -X POST https://<tunnel>/api/workflow/enrich/execute \
  -H 'Content-Type: application/json' \
  -d '{"locationId":"<LOCATION_ID>","contactId":"<CONTACT_ID>"}' | jq
# -> { success:true, matched:true, creditsUsed:7, workEmail, phone, jobTitle, ... }
```

### 4.5 Custom Page UI inside GHL

```bash
cd enrichflow-ui
npm run build                # outputs dist/ ; the API auto-serves it at /app
```

Now `https://<tunnel>/app?locationId=<LOCATION_ID>` renders the UI. In GHL, open the app's
Custom Page — it loads the same URL in an iframe with `locationId` injected. Test:

- **Enrich a contact** tab → By details → Preview, then Enrich.
- **Bulk enrich** tab → search/select contacts → Enrich N (runs sequentially, writes back + charges).
- **Usage** tab → totals + recent runs (reads from Mongo).

---

## 5. Enabling real providers & billing

### Real enrichment providers

```env
ENRICH_PRIMARY=prospeo
ENRICH_FALLBACK=pdl
PROSPEO_API_KEY=...
PDL_API_KEY=...
```

Per-request override for testing one provider:

```bash
curl -s -X POST http://localhost:3010/api/enrich/preview \
  -H 'Content-Type: application/json' \
  -d '{"primary":"pdl","fallback":"pdl","input":{"email":"jane.doe@acme.io","fullName":"Jane Doe"}}' | jq
```

### Mandatory subscription

```env
SUBSCRIPTION_REQUIRED=true      # default; mandatory plan gate
PLAN_NAME=Starter
PLAN_PRICE_USD=29
PLAN_INCLUDED_CREDITS=300
```

- GHL runs the recurring billing — **there is no `subscription.charged` webhook for apps**. The
  entitlement signal is the **install lifecycle**:
  - `INSTALL` (payload includes `planId` + `trial`) → activate; `trial.onTrial` → status `trialing`.
  - `PLAN_CHANGE` (`newPlanId`) → remap the plan / credit allowance.
  - `UNINSTALL` → cancel (this is also how a failed payment surfaces: GHL retries 3 days, then
    auto-uninstalls).
- GHL only sends a **planId** — EnrichFlow maps it to a credit allowance (default plan, or the
  optional `PLANS_JSON` catalog for multiple tiers).
- Every GHL-mode enrichment is **gated**: no entitled subscription → `402 SUBSCRIPTION_REQUIRED`.
- Each run consumes **included** credits first; only **overage** hits the wallet.
- Monthly included-credit reset is a lazy roll-over on our own clock (anchored at install/trial).

> Local note: `.env` ships with `SUBSCRIPTION_REQUIRED=false` so direct `/oauth/authorize` installs
> (which don't fire an INSTALL webhook) aren't blocked. Set it to `true` to exercise the gate, and use
> the dev helper to simulate an active plan:
> ```bash
> curl -s -X POST http://localhost:3010/api/subscription/dev-activate \
>   -H 'Content-Type: application/json' -d '{"locationId":"<LOC>"}' | jq
> curl -s "http://localhost:3010/api/subscription/status?locationId=<LOC>" | jq
> ```

### Wallet billing (overage)

```env
BILLING_ENABLED=true
CREDIT_PRICE_USD=0.05
GHL_METER_ID=<usage meter id from the app's billing config>
```

With billing on, each GHL-mode enrichment checks wallet funds and posts a usage charge for the
**overage credits only** (`overage × CREDIT_PRICE_USD`). The `billing` block in the response reports
`coveredByPlan`, `overageCredits`, and `charged:true` + `chargeId` when the wallet was hit.
Local-mode runs (no `locationId`) are never gated and never charged.

> Safety: billing only fires in GHL mode (`locationId` present) **and** when `BILLING_ENABLED=true`
> **and** a meter is configured. Otherwise it's a logged no-op so testing never moves money.

---

## 6. Endpoint reference

| Method & path | Purpose |
|---|---|
| `GET /health` | liveness + db status |
| `GET /oauth/authorize` | start install (redirect to GHL) |
| `GET /oauth/callback` | OAuth code exchange + token storage |
| `GET /oauth/status?locationId=` | is this location connected? |
| `POST /api/webhooks/enrichflow` | INSTALL / UNINSTALL lifecycle |
| `POST /api/enrich/preview` | dry run (no charge, no write-back) |
| `POST /api/enrich` | full enrich — GHL mode or local mode |
| `POST /api/workflow/enrich/execute` | custom workflow action execution |
| `GET /api/workflow/enrich/fields` | output field schema for the action |
| `GET /api/contacts?locationId=` | list contacts (UI bulk picker) |
| `GET /api/subscription/status?locationId=` | entitlement + plan + included-credit usage |
| `POST /api/subscription/dev-activate` | local helper to simulate an active plan (non-prod) |
| `GET /api/analytics/usage?locationId=` | usage summary + recent runs |
| `GET /app` | Custom Page UI (when `enrichflow-ui/dist` is built) |

---

## 7. Quick test checklist

- [ ] `npm run enrich:local` prints credits per case (7 / 2 / 0 / 1)
- [ ] `/api/enrich/preview` returns enriched data, no billing
- [ ] `/api/enrich` local mode returns a `billing` block with `skipped:"billing_disabled"`
- [ ] UI dev server loads; Preview works without a connection
- [ ] OAuth install → `/oauth/status` shows `connected:true`
- [ ] INSTALL webhook → `/api/subscription/status` shows `status:"active"` + included pool
- [ ] With `SUBSCRIPTION_REQUIRED=true` and no plan → `/api/enrich` returns `402 SUBSCRIPTION_REQUIRED`
- [ ] `/api/enrich` GHL mode writes fields back; `billing` shows `coveredByPlan` then `overageCredits`
- [ ] Workflow action enriches an enrolled contact
- [ ] Bulk enrich + Usage dashboard (incl. plan card) reflect the runs
- [ ] (optional) `BILLING_ENABLED=true` + overage → response shows `charged:true`
